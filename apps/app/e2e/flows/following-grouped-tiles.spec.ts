import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import {
  clickRenderedPropertyMarkerById,
  type MapFeature,
  type WindowWithMapInstance,
} from '../helpers/map-instance';

const API_BASE_URL = getPlaywrightApiUrl();
const FOLLOWING_AREA_BBOX = '5.47,51.48,5.49,51.50';
const FOLLOWING_ZOOM = 16;
const FOLLOWING_TIME_WINDOW = '10d';
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;
const AUTH_SETUP_RETRIES = 3;
const AUTH_SETUP_RETRY_DELAY_MS = 500;

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: Record<string, unknown> & {
    id: string;
    username?: string;
  };
};

type FollowingNearbyResult = {
  primaryPropertyId: string;
  coordinate: [number, number];
  groupKind: 'single' | 'cluster';
  nodeClass: 'active';
};

type SeedProperty = {
  id: string;
  address?: string | null;
  geometry: {
    coordinates: [number, number];
  };
};

type FeedSeedProperty = {
  id: string;
  address?: string | null;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  } | null;
};

async function createTestSession(request: APIRequestContext, suffix: string): Promise<AuthSession> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= AUTH_SETUP_RETRIES; attempt += 1) {
    const unique = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const response = await request.post(`${API_BASE_URL}/auth/google`, {
      data: { idToken: `mock-google-e2e${suffix}${unique}-gid${unique}` },
      timeout: 45_000,
    });

    if (response.ok()) {
      const body = await response.json();
      return {
        accessToken: body.session.accessToken as string,
        refreshToken: body.session.refreshToken as string,
        expiresAt: body.session.expiresAt as string,
        user: body.session.user as AuthSession['user'],
      };
    }

    const failureBody = await response.text().catch(() => 'unreadable response body');
    lastError = new Error(
      `createTestSession(${suffix}) attempt ${attempt}/${AUTH_SETUP_RETRIES} failed: ${response.status()} ${failureBody}`
    );

    if (attempt < AUTH_SETUP_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, AUTH_SETUP_RETRY_DELAY_MS));
    }
  }

  throw lastError ?? new Error(`createTestSession(${suffix}) failed`);
}

async function seedBrowserSession(page: Page, session: AuthSession) {
  await page.addInitScript((seededSession) => {
    window.localStorage.setItem('huishype_access_token', seededSession.accessToken);
    window.localStorage.setItem('huishype_refresh_token', seededSession.refreshToken);
    window.localStorage.setItem('huishype_user', JSON.stringify(seededSession.user));
    window.localStorage.setItem('huishype_token_expiry', seededSession.expiresAt);
  }, session);
}

async function waitForMapReady(page: Page, timeout = 60_000) {
  await page.waitForSelector('[data-testid="map-view"]', { timeout });
  await page.waitForSelector('[data-testid="map-view"] canvas', { timeout });
  await page.waitForFunction(
    () => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return Boolean(map && typeof map.getZoom === 'function' && map.isStyleLoaded?.());
    },
    null,
    { timeout, polling: 500 }
  );
}

async function setMapView(page: Page, center: [number, number], zoom = FOLLOWING_ZOOM) {
  await page.evaluate(
    ({ center, zoom }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      map?.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
    },
    { center, zoom }
  );

  await page.waitForFunction(
    ({ center, zoom }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) {
        return false;
      }

      const currentCenter = map.getCenter();
      return (
        Math.abs(map.getZoom() - zoom) < 0.1 &&
        Math.abs(currentCenter.lng - center[0]) < 0.001 &&
        Math.abs(currentCenter.lat - center[1]) < 0.001
      );
    },
    { center, zoom },
    { timeout: 15_000, polling: 250 }
  );

  await page.waitForTimeout(1_500);
}

async function waitForPropertiesSourceLoaded(page: Page, timeout = 30_000): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        return Boolean(
          map?.isStyleLoaded?.() &&
            map.getSource?.('properties-source') &&
            (map.isSourceLoaded?.('properties-source') ?? false)
        );
      },
      null,
      { timeout, polling: 500 }
    )
    .catch(() => {
      console.log('Following properties source did not report fully loaded before click attempt');
    });
}

async function clickRenderedFollowingNodeNearCoordinate(
  page: Page,
  coordinate: [number, number],
  timeoutMs = 15_000
) {
  try {
    const handle = await page.waitForFunction(
      ({ coordinate }) => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        if (!map || !map.isStyleLoaded?.()) {
          return null;
        }

        const canvas = map.getCanvas?.();
        if (!canvas) {
          return null;
        }

        const layers = ['active-nodes', 'property-clusters'].filter(
          (layer) => map.getLayer?.(layer)
        );
        if (layers.length === 0) {
          return null;
        }

        const projected = map.project(coordinate);
        const searchRadius = 80;
        const features = map.queryRenderedFeatures(
          [
            [projected.x - searchRadius, projected.y - searchRadius],
            [projected.x + searchRadius, projected.y + searchRadius],
          ],
          { layers }
        ) as MapFeature[];

        let best: { screenX: number; screenY: number; distance: number } | null = null;
        for (const feature of features) {
          if (feature.geometry?.type !== 'Point') {
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
          const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
          if (!best || distance < best.distance) {
            const rect = canvas.getBoundingClientRect();
            best = {
              screenX: rect.left + point.x,
              screenY: rect.top + point.y,
              distance,
            };
          }
        }

        return best;
      },
      { coordinate },
      { timeout: timeoutMs, polling: 500 }
    );

    const point = (await handle.jsonValue()) as
      | { screenX: number; screenY: number; distance: number }
      | null;
    if (!point) {
      return { success: false as const, reason: 'No rendered following node near coordinate' };
    }

    await page.mouse.move(point.screenX, point.screenY);
    await page.mouse.click(point.screenX, point.screenY);
    await page.waitForTimeout(500);
    return { success: true as const, distance: point.distance };
  } catch {
    return { success: false as const, reason: 'No rendered following node near coordinate' };
  }
}

async function getPropertySourceTileUrl(page: Page) {
  return page.evaluate(() => {
    const map = (window as WindowWithMapInstance).__mapInstance;
    const source = map?.getSource?.('properties-source') as
      | { serialize?: () => { tiles?: readonly string[] | null } | null }
      | null
      | undefined;
    const serialized = source?.serialize?.();
    const tiles = serialized?.tiles;
    return Array.isArray(tiles) ? (tiles[0] ?? null) : null;
  });
}

async function waitForPropertySourceTileUrl(page: Page) {
  await expect
    .poll(() => getPropertySourceTileUrl(page), {
      message: 'Expected properties-source tile URL to be available',
      timeout: 30_000,
    })
    .not.toBeNull();

  return await getPropertySourceTileUrl(page);
}

async function toggleFollowing(page: Page) {
  await page.getByTestId('map-filter-pill-following').click();
}

async function readFollowingPersistence(page: Page) {
  return page.evaluate(() => ({
    search: window.location.search,
    historySocialScope:
      (window.history.state as { huishypeMapView?: { socialScope?: string } } | null)
        ?.huishypeMapView?.socialScope ?? null,
    sessionSocialScope: window.sessionStorage.getItem('huishype.map.socialScope'),
  }));
}

async function fetchFollowingSeedProperty(request: APIRequestContext) {
  const scopedResponse = await request.get(
    `${API_BASE_URL}/properties?limit=1&bbox=${FOLLOWING_AREA_BBOX}&marketState=for-sale`
  );
  expect(scopedResponse.ok()).toBe(true);

  const scopedBody = await scopedResponse.json();
  expect(Array.isArray(scopedBody.data)).toBe(true);
  if (scopedBody.data.length > 0) {
    return scopedBody.data[0] as SeedProperty;
  }

  const feedResponse = await request.get(`${API_BASE_URL}/feed?limit=1&country=NL`);
  expect(feedResponse.ok()).toBe(true);
  const feedBody = await feedResponse.json();
  const feedProperty = (feedBody.items as FeedSeedProperty[] | undefined)?.find(
    (item) =>
      item.geometry?.type === 'Point' &&
      Array.isArray(item.geometry.coordinates) &&
      item.geometry.coordinates.length === 2
  );

  expect(
    feedProperty,
    `Expected at least one NL active-listing feed property after ${FOLLOWING_AREA_BBOX} returned no /properties rows`
  ).toBeTruthy();

  return {
    id: feedProperty!.id,
    address: feedProperty!.address ?? null,
    geometry: {
      coordinates: feedProperty!.geometry!.coordinates,
    },
  } satisfies SeedProperty;
}

async function waitForFollowingNearby(
  request: APIRequestContext,
  accessToken: string,
  coordinate: [number, number],
  activity = 'all-time'
): Promise<FollowingNearbyResult> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const response = await request.get(
      `${API_BASE_URL}/properties/following-nearby?lon=${coordinate[0]}&lat=${coordinate[1]}&zoom=${FOLLOWING_ZOOM}&marketState=for-sale&activity=${activity}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        timeout: 15_000,
      }
    );

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as FollowingNearbyResult | null;
    if (body) {
      return body;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Timed out waiting for following-nearby to return a grouped result');
}

async function seedFollowingActivity(
  request: APIRequestContext,
  viewer: AuthSession,
  actor: AuthSession,
  propertyId: string
) {
  const followResponse = await request.put(`${API_BASE_URL}/users/${actor.user.id}/follow`, {
    headers: { authorization: `Bearer ${viewer.accessToken}` },
    timeout: 30_000,
  });
  expect(followResponse.ok()).toBe(true);

  const commentResponse = await request.post(`${API_BASE_URL}/properties/${propertyId}/comments`, {
    data: { content: `Following grouped tiles ${Date.now()}` },
    headers: { authorization: `Bearer ${actor.accessToken}` },
    timeout: 30_000,
  });
  expect(commentResponse.status()).toBe(201);
}

test.use({ trace: 'off' });

test.describe('Following grouped tiles', () => {
  let consoleErrors: string[] = [];
  let allowedConsoleErrorPatterns: RegExp[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    allowedConsoleErrorPatterns = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') {
        return;
      }

      const text = msg.text();
      if (allowedConsoleErrorPatterns.some((pattern) => pattern.test(text))) {
        return;
      }
      if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
        consoleErrors.push(text);
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((error) => console.error(`  - ${error}`));
    }

    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('auth-gates the Following toggle without switching the map source', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);

    const initialTileUrl = await waitForPropertySourceTileUrl(page);
    expect(initialTileUrl).toContain('/tiles/properties/{z}/{x}/{y}.pbf');
    await expect(page.getByTestId('map-filter-pill-following')).toHaveText('Following');
    await page.getByTestId('map-filter-pill-following-arrow').click();
    await expect(page.getByTestId('map-filter-panel-following')).toBeVisible();
    await expect(page.getByTestId('map-filter-option-following-all-time')).toBeVisible();
    await page.getByTestId('map-filter-panel-following-close').click();

    await toggleFollowing(page);

    await expect(page.getByTestId('auth-modal-overlay')).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => getPropertySourceTileUrl(page), {
        timeout: 10_000,
      })
      .toBe(initialTileUrl);

    const persistence = await readFollowingPersistence(page);
    expect(persistence.search).not.toContain('socialScope');
    expect(persistence.historySocialScope).toBeNull();
    expect(persistence.sessionSocialScope).toBeNull();
  });

  test('uses the personalized Following tile source and still opens the preview/detail flow', async ({
    page,
    request,
  }) => {
    const viewer = await createTestSession(request, 'followingviewer');
    const actor = await createTestSession(request, 'followingactor');
    const property = await fetchFollowingSeedProperty(request);
    const propertyCoordinate = property.geometry.coordinates;

    await seedFollowingActivity(request, viewer, actor, property.id);
    const nearby = await waitForFollowingNearby(
      request,
      viewer.accessToken,
      propertyCoordinate,
      FOLLOWING_TIME_WINDOW
    );

    expect(nearby.primaryPropertyId).toBe(property.id);
    expect(nearby.nodeClass).toBe('active');
    expect(nearby.groupKind).toBe('single');

    await seedBrowserSession(page, viewer);

    const followingTileJsonResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/tiles/following/properties.json') &&
        response.request().method() === 'GET' &&
        new URL(response.url()).searchParams.get('activity') === FOLLOWING_TIME_WINDOW
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);

    const initialTileUrl = await waitForPropertySourceTileUrl(page);
    expect(initialTileUrl).toContain('/tiles/properties/{z}/{x}/{y}.pbf');

    await setMapView(page, nearby.coordinate, FOLLOWING_ZOOM);
    const followingTileResponse = page.waitForResponse(
      (response) =>
        /\/tiles\/following\/properties\/\d+\/\d+\/\d+\.pbf(?:\?|$)/.test(response.url()) &&
        new URL(response.url()).searchParams.get('activity') === FOLLOWING_TIME_WINDOW,
      { timeout: 30_000 }
    );

    await page.getByTestId('map-filter-pill-following-arrow').click();
    await expect(page.getByTestId('map-filter-panel-following')).toBeVisible();
    await page.getByTestId(`map-filter-option-following-${FOLLOWING_TIME_WINDOW}`).click();

    const tileJsonResponse = await followingTileJsonResponse;
    expect(tileJsonResponse.ok()).toBe(true);
    expect(new URL(tileJsonResponse.url()).searchParams.get('activity')).toBe(
      FOLLOWING_TIME_WINDOW
    );

    await expect
      .poll(() => getPropertySourceTileUrl(page), {
        timeout: 30_000,
      })
      .toContain('/tiles/following/properties/{z}/{x}/{y}.pbf');
    await expect
      .poll(() => getPropertySourceTileUrl(page), {
        timeout: 30_000,
      })
      .toContain(`activity=${FOLLOWING_TIME_WINDOW}`);

    const persistence = await readFollowingPersistence(page);
    expect(persistence.search).not.toContain('socialScope');
    expect(persistence.search).not.toContain('activity');
    expect(persistence.historySocialScope).toBe('following');
    expect(persistence.sessionSocialScope).toBe('following');

    await waitForPropertiesSourceLoaded(page);
    const tileResponse = await followingTileResponse;
    expect(tileResponse.ok()).toBe(true);
    expect(new URL(tileResponse.url()).searchParams.get('activity')).toBe(FOLLOWING_TIME_WINDOW);

    let clickResult = await clickRenderedPropertyMarkerById(
      page,
      nearby.primaryPropertyId,
      30_000
    );
    if (!clickResult.success) {
      const coordinateClickResult = await clickRenderedFollowingNodeNearCoordinate(
        page,
        nearby.coordinate,
        15_000
      );
      clickResult = coordinateClickResult.success
        ? {
            success: true,
            screenX: 0,
            screenY: 0,
            propertyId: nearby.primaryPropertyId,
          }
        : {
            success: false,
            reason: `${clickResult.reason}; ${coordinateClickResult.reason}`,
            propertyId: nearby.primaryPropertyId,
          };
    }
    expect(clickResult.success, clickResult.success ? '' : clickResult.reason).toBe(true);

    const previewCard = page.getByTestId('group-preview-card');
    await expect(previewCard).toBeVisible({ timeout: 15_000 });
    await expect(previewCard).toContainText(property.address?.split(',')[0] ?? '', {
      timeout: 15_000,
    });

    const propertyPreviewCard = page
      .locator('[data-testid="property-preview-card"], [data-testid="group-preview-property-card"]')
      .first();
    await expect(propertyPreviewCard).toBeVisible({ timeout: 10_000 });
    await propertyPreviewCard.click();

    await expect(page.locator('[data-testid="property-header-carousel"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('map-following-state-empty')).toHaveCount(0);
    await expect(page.getByTestId('map-following-state-error')).toHaveCount(0);
  });

  test('shows the empty Following state for authenticated viewers without qualifying activity', async ({
    page,
    request,
  }) => {
    const viewer = await createTestSession(request, 'followingempty');
    await seedBrowserSession(page, viewer);
    const property = await fetchFollowingSeedProperty(request);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);

    await toggleFollowing(page);
    await setMapView(page, property.geometry.coordinates, FOLLOWING_ZOOM);
    const diagnostics = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      const source = map?.getSource?.('properties-source') as
        | { serialize?: () => { tiles?: readonly string[] | null } | null }
        | null
        | undefined;
      const serialized = source?.serialize?.();
      const tileUrl = Array.isArray(serialized?.tiles) ? (serialized?.tiles[0] ?? null) : null;
      const canvas = map?.getCanvas?.();
      const renderedFeatures = map && canvas
        ? map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['property-clusters', 'active-nodes'] }
          )
        : [];
      const sourceFeatures = map?.querySourceFeatures?.('properties-source', {
        sourceLayer: 'properties',
      }) ?? [];

      return {
        tileUrl,
        isSourceLoaded: map?.isSourceLoaded?.('properties-source') ?? null,
        areTilesLoaded: map?.areTilesLoaded?.() ?? null,
        renderedCount: renderedFeatures.length,
        sourceCount: sourceFeatures.length,
      };
    });
    console.log('FOLLOWING EMPTY DIAGNOSTICS', diagnostics);

    await expect(page.getByTestId('map-following-state-empty')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('map-following-state-error')).toHaveCount(0);
  });

  test('shows the error Following state when the personalized tile source fails', async ({
    page,
    request,
  }) => {
    const viewer = await createTestSession(request, 'followingerror');
    await seedBrowserSession(page, viewer);
    allowedConsoleErrorPatterns.push(
      /Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)/
    );

    await page.route(/\/tiles\/following\/properties\.json(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'Synthetic Following tile failure',
        }),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);

    const followingTileJsonResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/tiles/following/properties.json') &&
        response.request().method() === 'GET'
    );

    await toggleFollowing(page);

    const tileJsonResponse = await followingTileJsonResponse;
    expect(tileJsonResponse.status()).toBe(500);

    await expect(page.getByTestId('map-following-state-error')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('map-following-state-empty')).toHaveCount(0);

    const persistence = await readFollowingPersistence(page);
    expect(persistence.search).not.toContain('socialScope');
    expect(persistence.historySocialScope).toBe('following');
    expect(persistence.sessionSocialScope).toBe('following');
  });
});
