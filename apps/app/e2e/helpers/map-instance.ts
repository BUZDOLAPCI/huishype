import type { Page } from '@playwright/test';
import type { VisualMapInstance, VisualMapStyleLike } from '../visual/helpers/visual-map-types';

export type MapPoint = {
  lng: number;
  lat: number;
};

export type MapFeatureProperties = Record<string, unknown> & {
  id?: string | number;
  property_ids?: string | string[];
  preview_property_ids?: string | string[];
  point_count?: number | string;
  cluster_id?: number | string;
  ghost_count?: number | string;
  active_count?: number | string;
  group_kind?: string;
  node_class?: string;
};

export type MapFeature = {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: MapFeatureProperties;
};

export type MapLayer = {
  id?: string;
  type?: string;
};

export type MapStyle = VisualMapStyleLike;

export type MapInstance = VisualMapInstance & {
  loaded?: () => boolean;
  rotateTo?: (bearing: number, options?: { duration?: number }) => void;
  touchPitch?: {
    isEnabled?: () => boolean;
  };
  keyboard?: {
    _rotationDisabled?: boolean;
  };
  dragRotate?: {
    _pitchWithRotate?: boolean;
  };
};

export type WindowWithMapInstance = Omit<Window, '__mapInstance'> & {
  __mapInstance?: MapInstance | null;
};

export type ClickRenderedPropertyMarkerResult =
  | {
      success: true;
      screenX: number;
      screenY: number;
      propertyId: string;
    }
  | {
      success: false;
      reason: string;
      propertyId?: string;
    };

export function toLngLatTuple(
  coordinates: unknown,
): [number, number] | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const [lng, lat] = coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return null;
  }

  return [lng, lat];
}

export function firstPropertyId(
  propertyIds: string | string[] | undefined,
): string | undefined {
  if (typeof propertyIds === 'string') {
    return propertyIds.split(',')[0];
  }

  return propertyIds?.[0];
}

export function countPropertyIds(
  propertyIds: string | string[] | undefined,
): number {
  if (!propertyIds) {
    return 0;
  }

  return typeof propertyIds === 'string'
    ? propertyIds.split(',').filter(Boolean).length
    : propertyIds.length;
}

export async function clickRenderedPropertyMarkerById(
  page: Page,
  propertyId: string,
  timeoutMs = 15000,
): Promise<ClickRenderedPropertyMarkerResult> {
  try {
    const handle = await page.waitForFunction(
      (targetPropertyId) => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        if (!map || !map.isStyleLoaded()) {
          return null;
        }

        const canvas = map.getCanvas();
        if (!canvas) {
          return null;
        }

        const layerNames = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'];
        const rect = canvas.getBoundingClientRect();

        for (const layerName of layerNames) {
          try {
            if (!map.getLayer(layerName)) {
              continue;
            }

            const features = map.queryRenderedFeatures(
              [[0, 0], [canvas.width, canvas.height]],
              { layers: [layerName] }
            ) || [];

            for (const feature of features) {
              const propertyIds = feature.properties?.property_ids;
              const featurePropertyId =
                feature.properties?.id ??
                (typeof propertyIds === 'string'
                  ? propertyIds.split(',')[0]
                  : propertyIds?.[0]);

              if (
                featurePropertyId !== targetPropertyId ||
                feature.geometry?.type !== 'Point'
              ) {
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
                screenX: rect.left + point.x,
                screenY: rect.top + point.y,
                propertyId: targetPropertyId,
              };
            }
          } catch {
            // ignore layer query errors while waiting for the marker to reappear
          }
        }

        return null;
      },
      propertyId,
      { timeout: timeoutMs, polling: 500 }
    );

    const point = (await handle.jsonValue()) as
      | { screenX: number; screenY: number; propertyId: string }
      | null;

    if (!point) {
      return { success: false, reason: 'Property not found in rendered features', propertyId };
    }

    await page.mouse.move(point.screenX, point.screenY);
    await page.mouse.click(point.screenX, point.screenY);
    await page.waitForTimeout(500);

    return {
      success: true,
      screenX: point.screenX,
      screenY: point.screenY,
      propertyId: point.propertyId,
    };
  } catch {
    return { success: false, reason: 'Property not found in rendered features', propertyId };
  }
}
