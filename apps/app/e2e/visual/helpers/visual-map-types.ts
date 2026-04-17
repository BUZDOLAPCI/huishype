export interface VisualMapFeatureProperties extends Record<string, unknown> {
  id?: string | number;
  point_count?: number | string;
  property_ids?: string;
  preview_property_ids?: string;
  cluster_id?: number | string;
  ghost_count?: number | string;
  active_count?: number | string;
}

export type VisualMapLngLatTuple = [number, number];
export type VisualMapPointTuple = [number, number];
export type VisualMapLngLatLike =
  | VisualMapLngLatTuple
  | VisualMapCenter
  | { lng: number; lat: number }
  | { lon: number; lat: number };
export type VisualMapPointLike = VisualMapPoint | VisualMapPointTuple;
export type VisualMapGeometryCoordinates =
  | VisualMapLngLatTuple
  | number[]
  | VisualMapCenter
  | { lng: number; lat: number }
  | { lon: number; lat: number };

export interface VisualMapFeatureLike {
  geometry: {
    type?: string;
    coordinates: VisualMapGeometryCoordinates;
  };
  properties?: VisualMapFeatureProperties;
}

export interface VisualMapPoint {
  x: number;
  y: number;
}

export interface VisualMapCenter {
  lng: number;
  lat: number;
}

export type VisualMapCanvasLike = HTMLCanvasElement;

export interface VisualMapStyleSourceLike {
  type?: string;
  tiles?: string[];
  url?: string;
  data?: unknown;
  _data?: unknown;
  serialize?: () => VisualMapSerializedSourceLike;
  getClusterChildren?: (...args: unknown[]) => unknown;
  getClusterLeaves?: (...args: unknown[]) => unknown;
  getClusterExpansionZoom?: (...args: unknown[]) => unknown;
}

export type VisualMapSerializedSourceLike = Record<string, unknown> & {
  type?: string;
};

export interface VisualMapStyleLayerLike {
  id: string;
  type?: string;
  name?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  source?: string;
  minzoom?: number;
  maxzoom?: number;
  metadata?: Record<string, unknown>;
  filter?: unknown;
}

export interface VisualMapLightLike extends Record<string, unknown> {
  name?: string;
  anchor?: string;
  color?: string;
  intensity?: number;
  position?: unknown;
}

export interface VisualMapStyleLike {
  name?: string;
  sources: Record<string, VisualMapStyleSourceLike>;
  layers: VisualMapStyleLayerLike[];
  light?: VisualMapLightLike;
}

export interface VisualMapClickEventLike {
  point: VisualMapPoint;
  lngLat?: VisualMapCenter;
  originalEvent?: Event;
  [key: string]: unknown;
}

export interface VisualMapInstance {
  areTilesLoaded: () => boolean;
  isStyleLoaded: () => boolean;
  getStyle: () => VisualMapStyleLike;
  getLayer: (layerId: string) => VisualMapStyleLayerLike | undefined;
  getCanvas: () => VisualMapCanvasLike;
  getCenter: () => VisualMapCenter;
  getZoom: () => number;
  getPitch: () => number;
  getBearing: () => number;
  setCenter: (center: VisualMapLngLatLike) => void;
  setZoom: (zoom: number) => void;
  setPitch: (pitch: number) => void;
  setBearing: (bearing: number) => void;
  jumpTo: (options: {
    center?: VisualMapLngLatLike;
    zoom?: number;
    pitch?: number;
    bearing?: number;
  }) => void;
  project: (coordinates: VisualMapGeometryCoordinates | VisualMapPointLike) => VisualMapPoint;
  unproject: (point: VisualMapPointLike) => VisualMapCenter;
  getSource: (sourceId: string) => VisualMapStyleSourceLike | undefined;
  getLight: () => VisualMapLightLike | undefined;
  getLayoutProperty: (layerId: string, name: string) => unknown;
  getPaintProperty: (layerId: string, name: string) => unknown;
  querySourceFeatures: (sourceId: string, options?: Record<string, unknown>) => VisualMapFeatureLike[];
  fire: (type: string, event: Record<string, unknown>) => void;
  once: (type: string, listener: (event: VisualMapClickEventLike) => void) => void;
  on: (type: string, listener: (event: VisualMapClickEventLike) => void) => void;
  off: (type: string, listener: (event: VisualMapClickEventLike) => void) => void;
  isMoving: () => boolean;
  isZooming: () => boolean;
  isRotating: () => boolean;
  queryRenderedFeatures: (
    geometry?: unknown,
    options?: { layers?: string[] },
  ) => VisualMapFeatureLike[];
}

export interface VisualBottomSheetRefLike {
  current?: {
    close: () => void;
    snapToIndex: (index: number) => void;
    getCurrentIndex?: () => number;
  } | null;
}

export interface VisualMapClickDebugLike extends Record<string, unknown> {
  point?: VisualMapPoint;
  layerNames?: string[];
  sheetIndex?: number | null;
  features?: VisualMapFeatureLike[];
}

export interface VisualMapContainerElement extends HTMLElement {
  _maplibre?: VisualMapInstance | null;
  __map?: VisualMapInstance | null;
}

declare global {
  interface Window {
    __mapInstance: VisualMapInstance;
    __bottomSheetRef: VisualBottomSheetRefLike;
    __sheetIndex: number;
    __mapClickFired: boolean;
    __mapClickDebug: VisualMapClickDebugLike;
    __debugHandler: ((event: VisualMapClickEventLike) => void) | null;
  }
}

export {};
