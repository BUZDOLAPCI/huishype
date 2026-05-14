import { expect, test } from '@playwright/test';

import { attachConsoleErrorCollector, expectNoConsoleErrors } from '../helpers/console';
import { getPlaywrightWebUrl } from '../helpers/runtime';
import { waitForMapReady } from './helpers';

type CameraSnapshot = {
  bootId: string | null;
  canvasProbe: string | null;
  flyToCalls: Array<{
    center?: [number, number];
    zoom?: number;
    duration?: number;
    essential?: boolean;
  }>;
  pathname: string;
};

const FIRST_CAMERA_PATH = '/@51.4588672,5.4525952,16z';
const SECOND_CAMERA_PATH = '/@51.4385345,5.5186267,13.33z';

test('browser back and forward between camera URLs move the existing map in place', async ({
  page,
}) => {
  const consoleErrors = attachConsoleErrorCollector(page);

  await page.addInitScript(() => {
    window.__hhCameraHistoryBootId = Math.random().toString(36).slice(2);
  });

  await page.goto(`${getPlaywrightWebUrl()}${FIRST_CAMERA_PATH}`);
  await waitForMapReady(page);
  await page.waitForFunction(() => !!window.__mapInstance);

  await page.evaluate(() => {
    const map = window.__mapInstance;
    if (!map) {
      throw new Error('Expected map instance to be available');
    }

    const originalFlyTo = map.flyTo.bind(map);
    const flyToCalls: NonNullable<Window['__hhCameraHistoryFlyToCalls']> = [];
    window.__hhCameraHistoryFlyToCalls = flyToCalls;
    map.flyTo = (options) => {
      flyToCalls.push({
        center: Array.isArray(options.center)
          ? [options.center[0], options.center[1]]
          : undefined,
        zoom: options.zoom,
        duration: options.duration,
        essential: options.essential,
      });

      return originalFlyTo({
        ...options,
        duration: 0,
      });
    };
  });

  const before = await readCameraSnapshot(page);

  await page.evaluate((nextPath) => {
    window.history.pushState(window.history.state, '', nextPath);
    window.dispatchEvent(
      new PopStateEvent('popstate', { state: window.history.state }),
    );
  }, SECOND_CAMERA_PATH);
  await waitForCameraPath(page, SECOND_CAMERA_PATH);

  const afterSecondCamera = await readCameraSnapshot(page);
  expect(afterSecondCamera.bootId).toBe(before.bootId);
  expect(afterSecondCamera.canvasProbe).toBe(before.canvasProbe);
  expect(afterSecondCamera.flyToCalls.at(-1)).toMatchObject({
    center: [5.5186267, 51.4385345],
    zoom: 13.33,
    duration: 700,
    essential: true,
  });

  await page.goBack();
  await waitForCameraPath(page, FIRST_CAMERA_PATH);

  const afterBack = await readCameraSnapshot(page);
  expect(afterBack.bootId).toBe(before.bootId);
  expect(afterBack.canvasProbe).toBe(before.canvasProbe);
  expect(afterBack.flyToCalls.at(-1)).toMatchObject({
    center: [5.4525952, 51.4588672],
    zoom: 16,
    duration: 700,
    essential: true,
  });

  await page.goForward();
  await waitForCameraPath(page, SECOND_CAMERA_PATH);

  const afterForward = await readCameraSnapshot(page);
  expect(afterForward.bootId).toBe(before.bootId);
  expect(afterForward.canvasProbe).toBe(before.canvasProbe);
  expect(afterForward.flyToCalls.at(-1)).toMatchObject({
    center: [5.5186267, 51.4385345],
    zoom: 13.33,
    duration: 700,
    essential: true,
  });

  expectNoConsoleErrors(consoleErrors);
});

async function waitForCameraPath(
  page: import('@playwright/test').Page,
  pathname: string,
) {
  await page.waitForFunction(
    (expectedPathname) => window.location.pathname === expectedPathname,
    pathname,
  );
  await page.waitForFunction(() => {
    const map = window.__mapInstance;
    return !!map && !map.isMoving?.();
  });
}

async function readCameraSnapshot(
  page: import('@playwright/test').Page,
): Promise<CameraSnapshot> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
    if (canvas && !canvas.dataset.hhCameraHistoryProbe) {
      canvas.dataset.hhCameraHistoryProbe = Math.random().toString(36).slice(2);
    }

    return {
      bootId: window.__hhCameraHistoryBootId ?? null,
      canvasProbe: canvas?.dataset.hhCameraHistoryProbe ?? null,
      flyToCalls: window.__hhCameraHistoryFlyToCalls ?? [],
      pathname: window.location.pathname,
    };
  });
}

declare global {
  interface Window {
    __hhCameraHistoryBootId?: string;
    __hhCameraHistoryFlyToCalls?: Array<{
      center?: [number, number];
      zoom?: number;
      duration?: number;
      essential?: boolean;
    }>;
  }
}
