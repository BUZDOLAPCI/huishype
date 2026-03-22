/**
 * useMapInteraction — shared map interaction state and logic for web and native map screens.
 *
 * Extracts selection state, preview-group state, cluster paging, bottom-sheet state
 * transitions, auth-gated action triggers, search-selection behavior, and feature-press
 * logic that was previously duplicated between index.tsx (native) and index.web.tsx (web).
 *
 * Platform renderers remain separate — this hook owns only the interaction model.
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import type { PropertyBottomSheetRef } from '@/src/components/PropertyBottomSheet';
import { useProperty } from '@/src/hooks/useProperties';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { LARGE_CLUSTER_THRESHOLD } from '@/src/hooks/useClusterPreview';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';
import { fetchBatchProperties, type PropertyResolveResult, type NearbyClusterResult } from '@/src/utils/api';

// ── Types ────────────────────────────────────────────────────────────

/** State for the geo-anchored preview card (single or cluster). */
export interface PreviewGroup {
  properties: GroupPreviewProperty[];
  coordinate: [number, number]; // [longitude, latitude]
}

/** Camera command abstraction so the hook never depends on a concrete map SDK. */
export interface MapCameraCommands {
  flyTo: (opts: { center: [number, number]; zoom: number; duration: number }) => void;
  fitBounds: (bounds: [number, number, number, number], opts: { padding: number; duration: number }) => void;
  /** For web: returns estimated zoom from cameraForBounds. For native: not used. */
  estimateZoomForBounds?: (bounds: [[number, number], [number, number]]) => number | null;
}

export interface UseMapInteractionReturn {
  // ── Selection state ─────────────────────────────────────────
  selectedPropertyId: string | null;
  setSelectedPropertyId: (id: string | null) => void;
  selectedProperty: ReturnType<typeof useProperty>['data'];
  selectedPropertyLoading: boolean;

  // ── Preview group state ─────────────────────────────────────
  previewGroup: PreviewGroup | null;
  setPreviewGroup: (group: PreviewGroup | null) => void;
  currentPreviewIndex: number;
  setCurrentPreviewIndex: (index: number) => void;

  // ── Bottom sheet ────────────────────────────────────────────
  bottomSheetRef: React.RefObject<PropertyBottomSheetRef | null>;
  sheetIndexRef: React.MutableRefObject<number>;
  handleSheetIndexChange: (index: number) => void;
  handleSheetClose: () => void;

  // ── Like / Save ─────────────────────────────────────────────
  isLiked: boolean;
  isSaved: boolean;
  toggleLike: () => void;
  toggleSave: () => void;

  // ── Auth modal ──────────────────────────────────────────────
  showAuthModal: boolean;
  authMessage: string;
  handleAuthRequired: (message?: string) => void;
  handleAuthModalClose: () => void;
  handleAuthSuccess: () => void;
  /** Dismiss bottom sheet + clear selection before auth flow starts (prevents crash). */
  handleAuthStarting: () => void;

  // ── Quick-action handlers ───────────────────────────────────
  handleLike: (property?: any) => void;
  handleComment: (property?: any) => void;
  handleGuess: (property?: any) => void;
  handleSave: (propertyId?: string) => void;
  handleShare: (propertyId: string) => void;
  handleGuessPress: (propertyId: string) => void;
  handleCommentPress: (propertyId: string) => void;

  // ── Preview card interaction handlers ───────────────────────
  handlePreviewPropertyTap: (property: GroupPreviewProperty) => void;
  handleClosePreview: () => void;

  // ── Search callbacks ────────────────────────────────────────
  handlePropertyResolved: (property: PropertyResolveResult, camera: MapCameraCommands) => void;
  handleLocationResolved: (coordinates: { lon: number; lat: number }, address: string, camera: MapCameraCommands) => void;

  // ── Feature-press / map-tap logic ───────────────────────────
  /** Process rendered features at a tap point. Returns true if a feature was handled. */
  handleFeaturePress: (features: GeoJSON.Feature[], currentZoom: number, camera: MapCameraCommands) => Promise<boolean>;
  /** Process a nearby-cluster API result (native fallback). Returns true if handled. */
  handleNearbyResult: (result: NearbyClusterResult, currentZoom: number, camera: MapCameraCommands) => void;
  /** Decide whether to dismiss the preview (empty background tap). */
  handleEmptyMapTap: () => void;
  /** Open a cluster preview by batch-fetching property IDs and geo-anchoring. */
  openClusterPreviewAtCoord: (propertyIds: string[], coordinate: [number, number]) => Promise<void>;

  // ── Conversion helpers ──────────────────────────────────────
  toGroupProperty: (p: ToGroupPropertyInput, activityScore?: number) => GroupPreviewProperty;
}

/** Minimal shape accepted by the toGroupProperty converter. */
export interface ToGroupPropertyInput {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  officialValuation?: number | null;
  askingPrice?: number | null;
  activityScore?: number;
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Derive activity level from a numeric score. */
export function getActivityLevel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 50) return 'hot';
  if (score > 0) return 'warm';
  return 'cold';
}

/** Estimate the zoom level that would show a bbox, conservatively accounting for padding. */
export function estimateZoomForBbox(west: number, south: number, east: number, north: number): number {
  const lonSpan = Math.abs(east - west);
  const latSpan = Math.abs(north - south);
  const maxSpan = Math.max(lonSpan, latSpan, 0.0001);
  return Math.log2(360 / maxSpan) - 1; // -1 accounts for padding
}

/** Convert a property-like object to GroupPreviewProperty. */
function convertToGroupProperty(
  p: ToGroupPropertyInput,
  activityScore?: number,
): GroupPreviewProperty {
  const score = activityScore ?? p.activityScore ?? 0;
  return {
    id: p.id,
    address: p.address,
    city: p.city,
    postalCode: p.postalCode,
    officialValuation: p.officialValuation,
    askingPrice: p.askingPrice ?? null,
    activityLevel: getActivityLevel(score),
    activityScore: score,
    thumbnailUrl: p.geometry
      ? getPropertyThumbnailFromGeometry(p.geometry)
      : null,
    yearBuilt: p.yearBuilt ?? null,
    floorAreaM2: p.floorAreaM2 ?? null,
  };
}

// Re-export for consumers
export { LARGE_CLUSTER_THRESHOLD };

// ── Hook ─────────────────────────────────────────────────────────────

export function useMapInteraction(): UseMapInteractionReturn {
  // ── Selection state ─────────────────────────────────────────
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const { data: selectedProperty, isLoading: selectedPropertyLoading } = useProperty(selectedPropertyId);

  // ── Preview group state ─────────────────────────────────────
  const [previewGroup, setPreviewGroup] = useState<PreviewGroup | null>(null);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);

  // Sync selected property with current preview card index
  useEffect(() => {
    if (previewGroup && previewGroup.properties[currentPreviewIndex]) {
      setSelectedPropertyId(previewGroup.properties[currentPreviewIndex].id);
    }
  }, [currentPreviewIndex, previewGroup]);

  // ── Bottom sheet ────────────────────────────────────────────
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  // -1 = closed, 0 = peek, 1 = partial, 2 = full
  const sheetIndexRef = useRef<number>(-1);

  const handleSheetIndexChange = useCallback((index: number) => {
    sheetIndexRef.current = index;
    // Expose for web testing (window global)
    if (typeof window !== 'undefined') {
      (window as unknown as { __sheetIndex: number }).__sheetIndex = index;
    }
  }, []);

  // CRITICAL: Per expectation 0023, preview card should STAY OPEN when sheet is dismissed.
  // The preview only closes when user explicitly taps empty map background while sheet is in peek/closed state.
  const handleSheetClose = useCallback(() => {
    // Intentionally empty — do NOT clear previewGroup here.
  }, []);

  // ── Like / Save ─────────────────────────────────────────────
  const handleAuthRequired = useCallback((message?: string) => {
    setAuthMessage(message || 'Sign in to continue');
    setShowAuthModal(true);
  }, []);

  const { isLiked, toggleLike } = usePropertyLike({
    propertyId: selectedPropertyId,
    onAuthRequired: () => handleAuthRequired('Sign in to like this property'),
  });

  const { isSaved, toggleSave } = usePropertySave({
    propertyId: selectedPropertyId,
    onAuthRequired: () => handleAuthRequired('Sign in to save this property'),
  });

  // ── Auth modal ──────────────────────────────────────────────
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState('Sign in to continue');

  const handleAuthModalClose = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  // Dismiss bottom sheet + clear selection before auth flow starts.
  // Prevents Reanimated/GestureDetector crash in PriceGuessSlider.
  const handleAuthStarting = useCallback(() => {
    bottomSheetRef.current?.close();
    setSelectedPropertyId(null);
    setPreviewGroup(null);
  }, []);

  // ── Quick-action handlers ───────────────────────────────────
  const handleLike = useCallback((_property?: any) => {
    toggleLike();
  }, [toggleLike]);

  const handleComment = useCallback((_property?: any) => {
    bottomSheetRef.current?.scrollToComments();
  }, []);

  const handleGuess = useCallback((_property?: any) => {
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  const handleSave = useCallback((_propertyId?: string) => {
    toggleSave();
  }, [toggleSave]);

  const handleShare = useCallback((_propertyId: string) => {
    // Sharing is handled within QuickActions component
  }, []);

  const handleGuessPress = useCallback((_propertyId: string) => {
    // TODO: Open full guess modal
  }, []);

  const handleCommentPress = useCallback((_propertyId: string) => {
    // TODO: Open comments section
  }, []);

  // ── Preview card interaction handlers ───────────────────────
  const handlePreviewPropertyTap = useCallback((property: GroupPreviewProperty) => {
    setSelectedPropertyId(property.id);
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewGroup(null);
  }, []);

  // ── Conversion helper (stable ref) ─────────────────────────
  const toGroupProperty = useCallback(
    (p: ToGroupPropertyInput, activityScore?: number) =>
      convertToGroupProperty(p, activityScore),
    [],
  );

  // ── Cluster preview ─────────────────────────────────────────
  const openClusterPreviewAtCoord = useCallback(
    async (propertyIds: string[], coordinate: [number, number]) => {
      try {
        const batch = await fetchBatchProperties(propertyIds.slice(0, 50));
        if (batch.length > 0) {
          setPreviewGroup({
            properties: batch.map(b => toGroupProperty({ ...b, activityScore: 0 })),
            coordinate,
          });
          setCurrentPreviewIndex(0);
        }
      } catch (err) {
        console.warn('[HuisHype] Batch fetch for cluster preview failed:', err);
      }
    },
    [toGroupProperty],
  );

  // ── Feature press (shared logic for both web click and native tap) ──
  const handleFeaturePress = useCallback(
    async (
      features: GeoJSON.Feature[],
      currentZoom: number,
      camera: MapCameraCommands,
    ): Promise<boolean> => {
      if (!features.length) return false;
      const feature = features[0];
      const properties = feature.properties;
      if (!properties) return false;

      const isCluster =
        properties.point_count !== undefined && properties.point_count > 1;

      if (isCluster) {
        const pointCount = (properties.point_count as number) ?? 0;
        const propertyIdsStr = properties.property_ids as string | undefined;
        const clusterGeom = feature.geometry;

        if (pointCount > LARGE_CLUSTER_THRESHOLD || !propertyIdsStr) {
          // Large cluster or missing IDs — zoom into bbox
          const bboxWest = properties.bbox_west as number | undefined;
          const bboxSouth = properties.bbox_south as number | undefined;
          const bboxEast = properties.bbox_east as number | undefined;
          const bboxNorth = properties.bbox_north as number | undefined;

          if (bboxWest != null && bboxSouth != null && bboxEast != null && bboxNorth != null) {
            const estimatedZoom = estimateZoomForBbox(bboxWest, bboxSouth, bboxEast, bboxNorth);

            if (estimatedZoom > currentZoom + 0.5) {
              camera.fitBounds(
                [bboxWest, bboxSouth, bboxEast, bboxNorth],
                { padding: 80, duration: 500 },
              );
            } else {
              camera.flyTo({
                center: [(bboxWest + bboxEast) / 2, (bboxSouth + bboxNorth) / 2],
                zoom: Math.min(currentZoom + 2, 18),
                duration: 500,
              });
            }
          } else if (clusterGeom && clusterGeom.type === 'Point') {
            const [lng, lat] = clusterGeom.coordinates as [number, number];
            camera.flyTo({
              center: [lng, lat],
              zoom: Math.min(currentZoom + 2, 18),
              duration: 500,
            });
          }
        } else {
          // Small cluster — show geo-anchored GroupPreviewCard
          const ids = propertyIdsStr.split(',');
          if (clusterGeom && clusterGeom.type === 'Point') {
            const coord = clusterGeom.coordinates as [number, number];
            await openClusterPreviewAtCoord(ids, coord);
          }
        }
        return true;
      } else {
        // Individual property
        const propertyId =
          (properties.id as string) ||
          (properties.property_ids as string | undefined)?.split(',')[0];
        const activityScore =
          (properties.activityScore as number) ??
          (properties.max_activity as number) ?? 0;
        const geom = feature.geometry;

        if (propertyId && geom && geom.type === 'Point') {
          const coord = geom.coordinates as [number, number];
          setSelectedPropertyId(propertyId);
          setPreviewGroup({
            properties: [{
              id: propertyId,
              address: (properties.address as string) ?? '',
              city: (properties.city as string) ?? '',
              postalCode: (properties.postalCode as string) ?? null,
              officialValuation: (properties.officialValuation as number) ?? null,
              askingPrice: (properties.askingPrice as number) ?? null,
              activityLevel: getActivityLevel(activityScore),
              activityScore,
              thumbnailUrl: getPropertyThumbnailFromGeometry(
                { type: 'Point', coordinates: coord },
              ),
              yearBuilt: null,
              floorAreaM2: null,
            }],
            coordinate: coord,
          });
          setCurrentPreviewIndex(0);
          return true;
        }
      }
      return false;
    },
    [openClusterPreviewAtCoord],
  );

  // ── Handle nearby cluster result (native fallback) ──────────
  const handleNearbyResult = useCallback(
    (result: NearbyClusterResult, currentZoom: number, camera: MapCameraCommands) => {
      if (result.type === 'single') {
        const coord = result.geometry?.coordinates as [number, number] | undefined;
        if (coord) {
          setSelectedPropertyId(result.id);
          setPreviewGroup({
            properties: [{
              id: result.id,
              address: result.address,
              city: result.city,
              postalCode: result.postalCode,
              officialValuation: result.officialValuation,
              askingPrice: result.askingPrice,
              activityLevel: getActivityLevel(result.activityScore ?? 0),
              activityScore: result.activityScore ?? 0,
              thumbnailUrl: getPropertyThumbnailFromGeometry(
                { type: 'Point', coordinates: coord },
              ),
            }],
            coordinate: coord,
          });
          setCurrentPreviewIndex(0);
        }
      } else if (result.type === 'cluster') {
        const pointCount = result.point_count ?? 0;
        if (pointCount > LARGE_CLUSTER_THRESHOLD) {
          // Large cluster — zoom in
          if (result.bbox) {
            const [west, south, east, north] = result.bbox;
            const estimatedZoom = estimateZoomForBbox(west, south, east, north);

            if (estimatedZoom > currentZoom + 0.5) {
              camera.fitBounds(
                [west, south, east, north],
                { padding: 80, duration: 500 },
              );
            } else {
              camera.flyTo({
                center: [(west + east) / 2, (south + north) / 2],
                zoom: Math.min(currentZoom + 2, 18),
                duration: 500,
              });
            }
          } else {
            camera.flyTo({
              center: result.coordinate,
              zoom: Math.min(currentZoom + 2, 18),
              duration: 500,
            });
          }
        } else {
          // Small cluster — show preview card
          const ids = result.property_ids.split(',');
          openClusterPreviewAtCoord(ids, result.coordinate);
        }
      }
    },
    [openClusterPreviewAtCoord],
  );

  // ── Empty map tap (dismiss logic) ───────────────────────────
  // Only close preview when bottom sheet is NOT expanded (peek or closed).
  // If sheet is expanded, the backdrop handles closing itself — preview persists.
  const handleEmptyMapTap = useCallback(() => {
    const currentSheetIndex =
      typeof window !== 'undefined' &&
      (window as unknown as { __sheetIndex?: number }).__sheetIndex !== undefined
        ? (window as unknown as { __sheetIndex: number }).__sheetIndex
        : sheetIndexRef.current;

    if (currentSheetIndex <= 0) {
      // Sheet is in peek (0) or closed (-1) state — safe to close preview
      if (previewGroup) {
        setPreviewGroup(null);
      }
    }
    // If sheet is expanded (1 or 2), don't close preview
  }, [previewGroup]);

  // ── Search callbacks ────────────────────────────────────────
  const handlePropertyResolved = useCallback(
    (property: PropertyResolveResult, camera: MapCameraCommands) => {
      const { lon, lat } = property.coordinates;
      const coord: [number, number] = [lon, lat];
      camera.flyTo({
        center: coord,
        zoom: 17,
        duration: 1000,
      });
      setSelectedPropertyId(property.id);
      setPreviewGroup({
        properties: [{
          id: property.id,
          address: property.address,
          city: property.city,
          postalCode: property.postalCode ?? null,
          officialValuation: property.officialValuation ?? null,
          askingPrice: null,
          activityLevel: 'cold',
          activityScore: 0,
          thumbnailUrl: getPropertyThumbnailFromGeometry(
            { type: 'Point', coordinates: coord },
          ),
        }],
        coordinate: coord,
      });
      setCurrentPreviewIndex(0);
    },
    [],
  );

  const handleLocationResolved = useCallback(
    (coordinates: { lon: number; lat: number }, _address: string, camera: MapCameraCommands) => {
      camera.flyTo({
        center: [coordinates.lon, coordinates.lat],
        zoom: 17,
        duration: 1000,
      });
    },
    [],
  );

  return {
    // Selection state
    selectedPropertyId,
    setSelectedPropertyId,
    selectedProperty,
    selectedPropertyLoading,

    // Preview group state
    previewGroup,
    setPreviewGroup,
    currentPreviewIndex,
    setCurrentPreviewIndex,

    // Bottom sheet
    bottomSheetRef,
    sheetIndexRef,
    handleSheetIndexChange,
    handleSheetClose,

    // Like / Save
    isLiked,
    isSaved,
    toggleLike,
    toggleSave,

    // Auth modal
    showAuthModal,
    authMessage,
    handleAuthRequired,
    handleAuthModalClose,
    handleAuthSuccess,
    handleAuthStarting,

    // Quick-action handlers
    handleLike,
    handleComment,
    handleGuess,
    handleSave,
    handleShare,
    handleGuessPress,
    handleCommentPress,

    // Preview card interaction handlers
    handlePreviewPropertyTap,
    handleClosePreview,

    // Search callbacks
    handlePropertyResolved,
    handleLocationResolved,

    // Feature press / map tap
    handleFeaturePress,
    handleNearbyResult,
    handleEmptyMapTap,
    openClusterPreviewAtCoord,

    // Conversion helpers
    toGroupProperty,
  };
}
