/**
 * useMapInteraction — shared map interaction state and logic for web and native map screens.
 *
 * Extracts selection state, preview-group state, cluster paging, bottom-sheet state
 * transitions, auth-gated action triggers, search-selection behavior, and feature-press
 * logic that was previously duplicated between index.tsx (native) and index.web.tsx (web).
 *
 * Platform renderers remain separate — this hook owns only the interaction model.
 */
import { useRef, useCallback, useState, useEffect, useMemo, startTransition } from 'react';
import { router } from 'expo-router';
import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import type { PropertyBottomSheetRef } from '@/src/components/PropertyBottomSheet';
import { useProperty, type PropertyFmvData } from '@/src/hooks/useProperties';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import {
  resolveAuthModalCopy,
  type AuthModalCopyInput,
  type ResolvedAuthModalCopy,
} from '@/src/lib/authModalCopy';
import { LARGE_CLUSTER_THRESHOLD } from '@/src/hooks/useClusterPreview';
import { PREVIEW_CARD_VIEWPORT_ANCHOR, type ViewportAnchor } from '@/src/lib/mapCameraAnchor';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { derivePropertyAerialImageUrl } from '@/src/utils/property-image';
import {
  fetchBatchProperties,
  type FollowingViewportItem,
  normalizeRenderedPropertyGroup,
  type PropertyResolveResult,
  type NearbyPropertyGroup,
} from '@/src/utils/api';
import {
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import {
  buildPropertyCommentsRoute,
  buildPropertyGuessesRoute,
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';

// ── Types ────────────────────────────────────────────────────────────

/** State for the geo-anchored preview card (single or cluster). */
export interface PreviewGroup {
  properties: GroupPreviewProperty[];
  coordinate: [number, number]; // [longitude, latitude]
}

/** Camera command abstraction so the hook never depends on a concrete map SDK. */
export interface MapCameraCommands {
  flyTo: (opts: {
    center: [number, number];
    zoom: number;
    duration: number;
    anchor?: ViewportAnchor;
  }) => void;
  fitBounds: (bounds: [number, number, number, number], opts: { padding: number; duration: number }) => void;
  /** For web: returns estimated zoom from cameraForBounds. For native: not used. */
  estimateZoomForBounds?: (bounds: [[number, number], [number, number]]) => number | null;
}

export interface UseMapInteractionReturn {
  // ── Selection state ─────────────────────────────────────────
  selectedPropertyId: string | null;
  setSelectedPropertyId: (id: string | null) => void;
  highlightedCoordinate: [number, number] | null;
  setHighlightedCoordinate: (coordinate: [number, number] | null) => void;
  selectedProperty: ReturnType<typeof useProperty>['data'];
  selectedPropertyForSheet: ReturnType<typeof useProperty>['data'];
  selectedPropertyLoading: boolean;

  // ── Preview group state ─────────────────────────────────────
  previewGroup: PreviewGroup | null;
  setPreviewGroup: (group: PreviewGroup | null) => void;
  currentPreviewIndex: number;
  setCurrentPreviewIndex: (index: number) => void;

  // ── Bottom sheet ────────────────────────────────────────────
  bottomSheetRef: React.RefObject<PropertyBottomSheetRef | null>;
  sheetIndexRef: React.MutableRefObject<number>;
  sheetIndex: number;
  handleSheetIndexChange: (index: number) => void;
  handleSheetClose: () => void;

  // ── Like / Save ─────────────────────────────────────────────
  isLiked: boolean;
  isSaved: boolean;
  toggleLike: () => void;
  toggleSave: () => void;

  // ── Auth modal ──────────────────────────────────────────────
  showAuthModal: boolean;
  authCopy: ResolvedAuthModalCopy;
  handleAuthRequired: (copy?: AuthModalCopyInput) => void;
  handleAuthModalClose: () => void;
  handleAuthSuccess: () => void;
  /** Dismiss bottom sheet + clear selection before auth flow starts (prevents crash). */
  handleAuthStarting: () => void;
  /** Clear transient preview/auth UI when the map surface loses focus. */
  resetTransientUI: () => void;

  // ── Quick-action handlers ───────────────────────────────────
  handleLike: (property?: string | GroupPreviewProperty | null) => void;
  handleComment: (property?: string | GroupPreviewProperty | null) => void;
  handleGuess: (property?: string | GroupPreviewProperty | null) => void;
  handleSave: (propertyId?: string) => void;
  handleShare: (propertyId: string) => void;
  handleGuessPress: (propertyId: string) => void;
  handleCommentPress: (propertyId: string) => void;

  // ── Preview card interaction handlers ───────────────────────
  handlePreviewPropertyTap: (property: GroupPreviewProperty) => void;
  handleClosePreview: () => void;

  // ── Search callbacks ────────────────────────────────────────
  handlePropertyResolved: (
    property: PropertyResolveResult,
    camera: MapCameraCommands,
    resolvedAddress?: ResolvedAddress,
  ) => void;
  handleLocationResolved: (coordinates: { lon: number; lat: number }, address: string, camera: MapCameraCommands) => void;

  // ── Feature-press / map-tap logic ───────────────────────────
  /** Process rendered features at a tap point. Returns true if a feature was handled. */
  handleFeaturePress: (features: GeoJSON.Feature[], currentZoom: number, camera: MapCameraCommands) => Promise<boolean>;
  /** Process a nearby grouped API result (native fallback). Returns true if handled. */
  handleNearbyResult: (result: NearbyPropertyGroup, currentZoom: number, camera: MapCameraCommands) => void;
  /** Open a preview directly from the authenticated following overlay payload. */
  handleFollowingOverlayPress: (
    item: FollowingViewportItem,
    currentZoom: number,
    camera: MapCameraCommands,
  ) => void;
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
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
  city: string;
  postalCode?: string | null;
  countryCode?: string | null;
  officialValuation?: number | null;
  askingPrice?: number | null;
  fmv?: number | PropertyFmvData | null;
  hasActiveListing?: boolean | null;
  marketState?: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed' | null;
  socialScore?: number | null;
  recentSocialScore?: number | null;
  lastSocialAt?: string | null;
  activityLevel?: 'hot' | 'warm' | 'cold' | null;
  activityScore?: number;
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  aerialImageUrl?: string | null;
  thumbnailUrl?: string | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  guessCount?: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Derive activity level from a numeric score. */
export function getActivityLevel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 50) return 'hot';
  if (score > 0) return 'warm';
  return 'cold';
}

const RECENT_HOT_SCORE_THRESHOLD = 0.5;

interface DerivedPreviewActivity {
  socialScore?: number;
  recentSocialScore?: number;
  activityScore?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
}

function derivePreviewActivity(input: {
  socialScore?: number | null;
  recentSocialScore?: number | null;
  activityScore?: number | null;
  activityLevel?: 'hot' | 'warm' | 'cold' | null;
  hasActiveListing?: boolean | null;
  bootstrapNeutral?: boolean;
}): DerivedPreviewActivity {
  const socialScore =
    typeof input.socialScore === 'number' ? input.socialScore : undefined;
  const recentSocialScore =
    typeof input.recentSocialScore === 'number' ? input.recentSocialScore : undefined;
  const activityScore =
    typeof input.activityScore === 'number'
      ? input.activityScore
      : socialScore;
  const isRecentHot = (recentSocialScore ?? 0) > RECENT_HOT_SCORE_THRESHOLD;

  if (isRecentHot) {
    return {
      socialScore,
      recentSocialScore,
      activityScore: activityScore ?? recentSocialScore,
      activityLevel: 'hot',
    };
  }

  if (typeof activityScore === 'number' && activityScore > 0) {
    const resolvedActivityScore = activityScore;
    return {
      socialScore,
      recentSocialScore,
      activityScore: resolvedActivityScore,
      activityLevel: getActivityLevel(resolvedActivityScore),
    };
  }

  if (input.hasActiveListing) {
    return {
      socialScore,
      recentSocialScore,
      activityScore: activityScore ?? 0,
      activityLevel: 'warm',
    };
  }

  if (input.activityLevel === 'hot' || input.activityLevel === 'warm' || input.activityLevel === 'cold') {
    return {
      socialScore,
      recentSocialScore,
      activityScore,
      activityLevel: input.activityLevel,
    };
  }

  if (input.bootstrapNeutral) {
    return {
      socialScore,
      recentSocialScore,
      activityScore,
    };
  }

  return {
    socialScore: socialScore ?? 0,
    recentSocialScore: recentSocialScore ?? 0,
    activityScore: activityScore ?? 0,
    activityLevel: 'cold',
  };
}

/** Estimate the zoom level that would show a bbox, conservatively accounting for padding. */
export function estimateZoomForBbox(west: number, south: number, east: number, north: number): number {
  const lonSpan = Math.abs(east - west);
  const latSpan = Math.abs(north - south);
  const maxSpan = Math.max(lonSpan, latSpan, 0.0001);
  return Math.log2(360 / maxSpan) - 1; // -1 accounts for padding
}

const PREVIEW_FLY_DURATION_MS = 500;
const SEARCH_PREVIEW_FLY_DURATION_MS = 1000;
const SEARCH_TARGET_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM + 1;
const MAX_GROUP_DRILL_IN_ZOOM = 18;
const PREVIEW_ZOOM_EPSILON = 0.5;

function shouldOpenClusterPreview(
  previewPropertyCount: number,
  pointCount: number,
  estimatedZoom: number | null,
  hasBbox: boolean,
  currentZoom: number,
): boolean {
  if (previewPropertyCount === 0) {
    return false;
  }

  if (pointCount <= LARGE_CLUSTER_THRESHOLD || !hasBbox || estimatedZoom == null) {
    return true;
  }

  if (currentZoom >= MAX_GROUP_DRILL_IN_ZOOM - PREVIEW_ZOOM_EPSILON) {
    return true;
  }

  return estimatedZoom <= currentZoom + PREVIEW_ZOOM_EPSILON;
}

function flyToPreviewAnchor(
  camera: MapCameraCommands,
  center: [number, number],
  zoom: number,
  duration: number,
): void {
  camera.flyTo({
    center,
    zoom,
    duration,
    anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
  });
}

function mergeHydratedPreviewProperty(
  currentProperty: GroupPreviewProperty,
  selectedProperty: NonNullable<ReturnType<typeof useProperty>['data']>,
): GroupPreviewProperty {
  const mergedActivity = derivePreviewActivity({
    socialScore: selectedProperty.socialScore ?? currentProperty.socialScore,
    recentSocialScore:
      selectedProperty.recentSocialScore ?? currentProperty.recentSocialScore,
    activityScore: selectedProperty.socialScore ?? currentProperty.activityScore,
    activityLevel: selectedProperty.activityLevel ?? currentProperty.activityLevel,
    hasActiveListing:
      selectedProperty.hasActiveListing ?? currentProperty.hasActiveListing,
  });
  const nextAerialImageUrl = derivePropertyAerialImageUrl(selectedProperty);
  const mergedOfficialValuation =
    currentProperty.officialValuation ?? selectedProperty.officialValuation ?? null;
  const mergedAskingPrice =
    currentProperty.askingPrice ?? selectedProperty.askingPrice ?? null;
  const mergedFmv =
    currentProperty.fmv ??
    (typeof selectedProperty.fmv === 'number'
      ? selectedProperty.fmv
      : selectedProperty.fmv?.fmv ?? null);
  const mergedAerialImageUrl =
    currentProperty.aerialImageUrl ??
    selectedProperty.aerialImageUrl ??
    nextAerialImageUrl;
  const mergedThumbnailUrl =
    currentProperty.thumbnailUrl ??
    selectedProperty.thumbnailUrl ??
    null;
  const mergedCommentCount =
    selectedProperty.commentCount ??
    selectedProperty.topLevelCommentCount ??
    currentProperty.commentCount ??
    0;
  const mergedGuessCount =
    selectedProperty.guessCount ?? currentProperty.guessCount ?? 0;
  const mergedLikeCount =
    selectedProperty.likeCount ??
    selectedProperty.propertyLikeCount ??
    currentProperty.likeCount ??
    0;

  return {
    ...currentProperty,
    coordinate:
      currentProperty.coordinate ??
      (selectedProperty.geometry?.type === 'Point' ? selectedProperty.geometry.coordinates : undefined),
    address: selectedProperty.address,
    city: selectedProperty.city,
    postalCode: selectedProperty.postalCode,
    countryCode: selectedProperty.countryCode,
    officialValuation: mergedOfficialValuation,
    askingPrice: mergedAskingPrice,
    fmv: mergedFmv,
    hasActiveListing:
      selectedProperty.hasActiveListing ?? currentProperty.hasActiveListing ?? null,
    marketState: selectedProperty.marketState ?? currentProperty.marketState ?? null,
    socialScore: mergedActivity.socialScore,
    recentSocialScore: mergedActivity.recentSocialScore,
    lastSocialAt: selectedProperty.lastSocialAt ?? currentProperty.lastSocialAt ?? null,
    activityLevel: mergedActivity.activityLevel,
    activityScore: mergedActivity.activityScore,
    aerialImageUrl: mergedAerialImageUrl,
    thumbnailUrl: mergedThumbnailUrl,
    yearBuilt: selectedProperty.yearBuilt,
    floorAreaM2: selectedProperty.floorAreaM2,
    likeCount: mergedLikeCount,
    commentCount: mergedCommentCount,
    guessCount: mergedGuessCount,
  };
}

/** Convert a property-like object to GroupPreviewProperty. */
function convertToGroupProperty(
  p: ToGroupPropertyInput,
  activityScore?: number,
): GroupPreviewProperty {
  const derivedActivity = derivePreviewActivity({
    socialScore: p.socialScore,
    recentSocialScore: p.recentSocialScore,
    activityScore: activityScore ?? p.activityScore,
    activityLevel: p.activityLevel,
    hasActiveListing: p.hasActiveListing,
  });
  const countryCode = p.countryCode ?? undefined;
  const aerialImageUrl = derivePropertyAerialImageUrl({
    aerialImageUrl: p.aerialImageUrl,
    imageryGeometry: p.imageryGeometry ?? null,
    geometry: p.geometry ?? null,
    countryCode,
  });

  return {
    id: p.id,
    address: p.address,
    coordinate: p.geometry?.coordinates,
    streetName: p.streetName ?? null,
    houseNumber: p.houseNumber ?? null,
    houseNumberAddition: p.houseNumberAddition ?? null,
    city: p.city,
    postalCode: p.postalCode,
    countryCode,
    officialValuation: p.officialValuation,
    askingPrice: p.askingPrice ?? null,
    fmv: typeof p.fmv === 'number' ? p.fmv : p.fmv?.fmv ?? null,
    hasActiveListing: p.hasActiveListing ?? null,
    marketState: p.marketState ?? null,
    socialScore: derivedActivity.socialScore,
    recentSocialScore: derivedActivity.recentSocialScore,
    lastSocialAt: p.lastSocialAt ?? null,
    activityLevel: derivedActivity.activityLevel,
    activityScore: derivedActivity.activityScore,
    thumbnailUrl: p.thumbnailUrl ?? null,
    aerialImageUrl,
    yearBuilt: p.yearBuilt ?? null,
    floorAreaM2: p.floorAreaM2 ?? null,
    likeCount: p.likeCount ?? 0,
    commentCount: p.commentCount ?? 0,
    guessCount: p.guessCount ?? 0,
  };
}

// Re-export for consumers
export { LARGE_CLUSTER_THRESHOLD };

// ── Hook ─────────────────────────────────────────────────────────────

export function useMapInteraction(): UseMapInteractionReturn {
  // ── Selection state ─────────────────────────────────────────
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [highlightedCoordinate, setHighlightedCoordinate] = useState<[number, number] | null>(null);
  const { data: selectedProperty, isLoading: selectedPropertyLoading } = useProperty(selectedPropertyId);

  // ── Preview group state ─────────────────────────────────────
  const [previewGroup, setPreviewGroup] = useState<PreviewGroup | null>(null);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const currentPreviewProperty = previewGroup?.properties[currentPreviewIndex] ?? null;
  const previewActivationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSheetSectionRef = useRef<'comments' | 'guess' | null>(null);

  const selectedPropertyForSheet = useMemo(() => {
    if (!selectedPropertyId || !selectedProperty) {
      return null;
    }

    const previewThumbnailUrl = currentPreviewProperty?.thumbnailUrl ?? null;
    const previewAerialImageUrl = currentPreviewProperty?.aerialImageUrl ?? null;
    const derivedAerialImageUrl = derivePropertyAerialImageUrl(selectedProperty);
    const aerialImageUrl = selectedProperty.aerialImageUrl ?? previewAerialImageUrl ?? derivedAerialImageUrl ?? null;
    const thumbnailUrl = selectedProperty.thumbnailUrl ?? previewThumbnailUrl ?? null;
    if (
      selectedProperty.aerialImageUrl === aerialImageUrl &&
      selectedProperty.thumbnailUrl === thumbnailUrl
    ) {
      return selectedProperty;
    }

    return {
      ...selectedProperty,
      aerialImageUrl,
      thumbnailUrl,
    };
  }, [currentPreviewProperty, selectedProperty, selectedPropertyId]);

  // Sync selected property with current preview card index
  useEffect(() => {
    if (previewGroup && previewGroup.properties[currentPreviewIndex]) {
      setSelectedPropertyId(previewGroup.properties[currentPreviewIndex].id);
    }
  }, [currentPreviewIndex, previewGroup]);

  useEffect(() => {
    if (!selectedProperty || !previewGroup) return;

    const currentProperty = previewGroup.properties[currentPreviewIndex];
    if (!currentProperty || currentProperty.id !== selectedProperty.id) return;
    const mergedProperty = mergeHydratedPreviewProperty(currentProperty, selectedProperty);

    setPreviewGroup((prev) => {
      if (!prev) return prev;
      const prevCurrent = prev.properties[currentPreviewIndex];
      if (!prevCurrent || prevCurrent.id !== selectedProperty.id) return prev;
      if (
        prevCurrent.aerialImageUrl === mergedProperty.aerialImageUrl &&
        prevCurrent.thumbnailUrl === mergedProperty.thumbnailUrl &&
        prevCurrent.address === mergedProperty.address &&
        prevCurrent.city === mergedProperty.city &&
        prevCurrent.postalCode === mergedProperty.postalCode &&
        prevCurrent.yearBuilt === mergedProperty.yearBuilt &&
        prevCurrent.floorAreaM2 === mergedProperty.floorAreaM2 &&
        prevCurrent.countryCode === mergedProperty.countryCode &&
        prevCurrent.officialValuation === mergedProperty.officialValuation &&
        prevCurrent.askingPrice === mergedProperty.askingPrice &&
        prevCurrent.fmv === mergedProperty.fmv &&
        prevCurrent.hasActiveListing === mergedProperty.hasActiveListing &&
        prevCurrent.marketState === mergedProperty.marketState &&
        prevCurrent.socialScore === mergedProperty.socialScore &&
        prevCurrent.recentSocialScore === mergedProperty.recentSocialScore &&
        prevCurrent.lastSocialAt === mergedProperty.lastSocialAt &&
        prevCurrent.activityLevel === mergedProperty.activityLevel &&
        prevCurrent.activityScore === mergedProperty.activityScore &&
        prevCurrent.likeCount === mergedProperty.likeCount &&
        prevCurrent.commentCount === mergedProperty.commentCount &&
        prevCurrent.guessCount === mergedProperty.guessCount
      ) {
        return prev;
      }

      const properties = [...prev.properties];
      properties[currentPreviewIndex] = mergedProperty;
      return { ...prev, properties };
    });
  }, [currentPreviewIndex, previewGroup, selectedProperty]);

  useEffect(() => {
    if (!selectedPropertyForSheet || !pendingSheetSectionRef.current) {
      return;
    }

    const pendingSection = pendingSheetSectionRef.current;
    pendingSheetSectionRef.current = null;

    if (pendingSection === 'comments') {
      bottomSheetRef.current?.scrollToComments();
      return;
    }

    bottomSheetRef.current?.scrollToGuess();
  }, [selectedPropertyForSheet]);

  // ── Bottom sheet ────────────────────────────────────────────
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  // -1 = closed, 0 = peek, 1 = partial, 2 = full
  const sheetIndexRef = useRef<number>(-1);
  const [sheetIndex, setSheetIndex] = useState(-1);

  const handleSheetIndexChange = useCallback((index: number) => {
    sheetIndexRef.current = index;
    setSheetIndex(index);
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
  const defaultAuthCopy = useMemo(
    () => resolveAuthModalCopy('Sign in to continue'),
    [],
  );

  const handleAuthRequired = useCallback((copy?: AuthModalCopyInput) => {
    setAuthCopy(resolveAuthModalCopy(copy, defaultAuthCopy));
    setShowAuthModal(true);
  }, [defaultAuthCopy]);

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
  const [authCopy, setAuthCopy] = useState(defaultAuthCopy);

  const handleAuthModalClose = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  const clearPreviewSelection = useCallback(() => {
    if (previewActivationTimeoutRef.current) {
      clearTimeout(previewActivationTimeoutRef.current);
      previewActivationTimeoutRef.current = null;
    }
    pendingSheetSectionRef.current = null;
    setHighlightedCoordinate(null);
    setPreviewGroup(null);
    setSelectedPropertyId(null);
    setCurrentPreviewIndex(0);
  }, []);

  const resetTransientUI = useCallback(() => {
    setShowAuthModal(false);
    bottomSheetRef.current?.close();
    handleSheetIndexChange(-1);
    clearPreviewSelection();
  }, [clearPreviewSelection, handleSheetIndexChange]);

  const schedulePreviewActivation = useCallback((duration: number, action: () => void) => {
    if (previewActivationTimeoutRef.current) {
      clearTimeout(previewActivationTimeoutRef.current);
      previewActivationTimeoutRef.current = null;
    }

    if (duration <= 0) {
      startTransition(action);
      return;
    }

    previewActivationTimeoutRef.current = setTimeout(() => {
      previewActivationTimeoutRef.current = null;
      startTransition(action);
    }, duration);
  }, []);

  useEffect(() => () => {
    if (previewActivationTimeoutRef.current) {
      clearTimeout(previewActivationTimeoutRef.current);
      previewActivationTimeoutRef.current = null;
    }
  }, []);

  // Dismiss bottom sheet + clear selection before auth flow starts.
  // Prevents Reanimated/GestureDetector crash in PriceGuessSlider.
  const handleAuthStarting = useCallback(() => {
    resetTransientUI();
  }, [resetTransientUI]);

  // ── Quick-action handlers ───────────────────────────────────
  const handleLike = useCallback((_property?: string | GroupPreviewProperty | null) => {
    toggleLike();
  }, [toggleLike]);

  const handleComment = useCallback((property?: string | GroupPreviewProperty | null) => {
    const targetProperty =
      typeof property === 'string'
        ? previewGroup?.properties.find((entry) => entry.id === property) ?? null
        : property ?? null;
    const targetId =
      typeof property === 'string'
        ? property
        : targetProperty?.id ?? selectedPropertyId;

    if (!targetId) {
      bottomSheetRef.current?.scrollToComments();
      return;
    }

    if (previewGroup) {
      const previewIndex = previewGroup.properties.findIndex((entry) => entry.id === targetId);
      if (previewIndex >= 0 && previewIndex !== currentPreviewIndex) {
        setCurrentPreviewIndex(previewIndex);
      }
    }

    if (targetProperty) {
      const targetCoordinate =
        targetProperty.coordinate ??
        previewGroup?.coordinate ??
        highlightedCoordinate ??
        (selectedProperty?.geometry?.type === 'Point' ? selectedProperty.geometry.coordinates : null);

      if (targetCoordinate) {
        setHighlightedCoordinate(targetCoordinate);
      }

      const targetAlreadyInPreview = previewGroup?.properties.some(
        (entry) => entry.id === targetProperty.id,
      ) ?? false;

      if (targetCoordinate && (!previewGroup || !targetAlreadyInPreview)) {
        setPreviewGroup({
          properties: [targetProperty],
          coordinate: targetCoordinate,
        });
        setCurrentPreviewIndex(0);
      }
    }

    if (selectedPropertyId !== targetId) {
      pendingSheetSectionRef.current = 'comments';
      setSelectedPropertyId(targetId);
      bottomSheetRef.current?.openFromPreview();
      return;
    }

    if (!selectedPropertyForSheet) {
      pendingSheetSectionRef.current = 'comments';
      bottomSheetRef.current?.openFromPreview();
      return;
    }

    bottomSheetRef.current?.scrollToComments();
  }, [
    currentPreviewIndex,
    highlightedCoordinate,
    previewGroup,
    selectedProperty,
    selectedPropertyForSheet,
    selectedPropertyId,
  ]);

  const handleGuess = useCallback((_property?: string | GroupPreviewProperty | null) => {
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  const handleSave = useCallback((_propertyId?: string) => {
    void toggleSave();
  }, [toggleSave]);

  const handleShare = useCallback((_propertyId: string) => {
    // Sharing is handled within QuickActions component
  }, []);

  const handleGuessPress = useCallback((_propertyId: string) => {
    const routeProperty =
      selectedPropertyForSheet ?? currentPreviewProperty ?? selectedProperty;
    if (!routeProperty) {
      return;
    }

    router.push(
      toInternalAppHref(
        buildPropertyGuessesRoute(
          routeProperty,
          buildPropertyRoute(routeProperty),
        ),
      ),
    );
  }, [currentPreviewProperty, selectedProperty, selectedPropertyForSheet]);

  const handleCommentPress = useCallback((_propertyId: string) => {
    const routeProperty =
      selectedPropertyForSheet ?? currentPreviewProperty ?? selectedProperty;
    if (!routeProperty) {
      return;
    }

    router.push(
      toInternalAppHref(
        buildPropertyCommentsRoute(
          routeProperty,
          buildPropertyRoute(routeProperty),
        ),
      ),
    );
  }, [currentPreviewProperty, selectedProperty, selectedPropertyForSheet]);

  // ── Preview card interaction handlers ───────────────────────
  const handlePreviewPropertyTap = useCallback((property: GroupPreviewProperty) => {
    setSelectedPropertyId(property.id);
    bottomSheetRef.current?.openFromPreview();
  }, []);

  const handleClosePreview = useCallback(() => {
    clearPreviewSelection();
  }, [clearPreviewSelection]);

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
        const batch = await fetchBatchProperties(
          propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
        );
        if (batch.length > 0) {
          setPreviewGroup({
            properties: batch.map(b => toGroupProperty(b)),
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
      const group = normalizeRenderedPropertyGroup(features[0]);
      if (!group) return false;

      if (group.groupKind === 'cluster') {
        const previewPropertyIds = group.previewPropertyIds.length > 0
          ? group.previewPropertyIds
          : group.propertyIds;
        const estimatedZoom = group.bbox
          ? estimateZoomForBbox(
              group.bbox.west,
              group.bbox.south,
              group.bbox.east,
              group.bbox.north,
            )
          : null;

        if (shouldOpenClusterPreview(
          previewPropertyIds.length,
          group.pointCount,
          estimatedZoom,
          !!group.bbox,
          currentZoom,
        )) {
          const coord = group.coordinate;
          setHighlightedCoordinate(coord);
          flyToPreviewAnchor(camera, coord, currentZoom, PREVIEW_FLY_DURATION_MS);
          schedulePreviewActivation(PREVIEW_FLY_DURATION_MS, () => {
            void openClusterPreviewAtCoord(previewPropertyIds, coord);
          });
        } else if (group.bbox) {
          camera.fitBounds(
            [group.bbox.west, group.bbox.south, group.bbox.east, group.bbox.north],
            { padding: 80, duration: 500 },
          );
        } else {
          const [lng, lat] = group.coordinate;
          camera.flyTo({
            center: [lng, lat],
            zoom: Math.min(currentZoom + 2, 18),
            duration: 500,
          });
        }
        return true;
      } else {
        const coord = group.coordinate;
        setHighlightedCoordinate(coord);
        flyToPreviewAnchor(camera, coord, currentZoom, PREVIEW_FLY_DURATION_MS);
        schedulePreviewActivation(PREVIEW_FLY_DURATION_MS, () => {
          const derivedActivity = derivePreviewActivity({
            socialScore: group.socialScoreMax,
            recentSocialScore: group.recentSocialScoreTotal,
            activityScore: group.socialScoreMax,
            hasActiveListing: group.hasActiveListing,
          });
          setSelectedPropertyId(group.primaryPropertyId);
          setPreviewGroup({
            properties: [{
              id: group.primaryPropertyId,
              coordinate: coord,
              address: group.address ?? '',
              streetName: group.streetName ?? null,
              houseNumber: group.houseNumber ?? null,
              houseNumberAddition: group.houseNumberAddition ?? null,
              city: group.city ?? '',
              postalCode: group.postalCode ?? null,
              countryCode: group.countryCode ?? undefined,
              officialValuation: group.officialValuation ?? null,
              askingPrice: group.askingPrice ?? null,
              hasActiveListing: group.hasActiveListing ?? null,
              marketState: group.marketState ?? null,
              socialScore: derivedActivity.socialScore,
              recentSocialScore: derivedActivity.recentSocialScore,
              activityLevel: derivedActivity.activityLevel,
              activityScore: derivedActivity.activityScore,
              thumbnailUrl: group.thumbnailUrl ?? null,
              aerialImageUrl: derivePropertyAerialImageUrl({
                geometry: { type: 'Point', coordinates: coord },
                countryCode: group.countryCode ?? undefined,
              }),
              yearBuilt: group.yearBuilt ?? null,
              floorAreaM2: group.floorAreaM2 ?? null,
              commentCount: group.commentCount ?? 0,
              guessCount: 0,
              likeCount: 0,
            }],
            coordinate: coord,
          });
          setCurrentPreviewIndex(0);
        });
        return true;
      }
      return false;
    },
    [openClusterPreviewAtCoord, schedulePreviewActivation],
  );

  // ── Handle nearby cluster result (native fallback) ──────────
  const handleNearbyResult = useCallback(
    (result: NearbyPropertyGroup, currentZoom: number, camera: MapCameraCommands) => {
      if (result.groupKind === 'single') {
        const coord = result.coordinate;
        setHighlightedCoordinate(coord);
        flyToPreviewAnchor(camera, coord, currentZoom, PREVIEW_FLY_DURATION_MS);
        schedulePreviewActivation(PREVIEW_FLY_DURATION_MS, () => {
          const previewAerialImageUrl = derivePropertyAerialImageUrl({
            geometry: { type: 'Point', coordinates: coord },
            countryCode: result.countryCode ?? undefined,
          });
          const derivedActivity = derivePreviewActivity({
            socialScore: result.socialScoreMax,
            recentSocialScore: result.recentSocialScoreTotal,
            activityScore: result.socialScoreMax,
            hasActiveListing: result.hasActiveListing,
          });
          setSelectedPropertyId(result.primaryPropertyId);
          setPreviewGroup({
            properties: [{
              id: result.primaryPropertyId,
              coordinate: coord,
              address: result.address ?? '',
              streetName: result.streetName ?? null,
              houseNumber: result.houseNumber ?? null,
              houseNumberAddition: result.houseNumberAddition ?? null,
              city: result.city ?? '',
              postalCode: result.postalCode,
              countryCode: result.countryCode ?? undefined,
              officialValuation: result.officialValuation,
              askingPrice: result.askingPrice,
              thumbnailUrl: result.thumbnailUrl,
              hasActiveListing: result.hasActiveListing ?? null,
              marketState: result.marketState ?? null,
              socialScore: derivedActivity.socialScore,
              recentSocialScore: derivedActivity.recentSocialScore,
              activityLevel: derivedActivity.activityLevel,
              activityScore: derivedActivity.activityScore,
              aerialImageUrl: previewAerialImageUrl,
              yearBuilt: result.yearBuilt ?? null,
              floorAreaM2: result.floorAreaM2 ?? null,
              commentCount: result.commentCount ?? 0,
              guessCount: 0,
              likeCount: 0,
            }],
            coordinate: coord,
          });
          setCurrentPreviewIndex(0);
        });
      } else if (result.groupKind === 'cluster') {
        const previewIds = result.previewPropertyIds;
        const estimatedZoom = result.bbox
          ? estimateZoomForBbox(
              result.bbox.west,
              result.bbox.south,
              result.bbox.east,
              result.bbox.north,
            )
          : null;

        if (shouldOpenClusterPreview(
          previewIds.length,
          result.pointCount,
          estimatedZoom,
          !!result.bbox,
          currentZoom,
        )) {
          setHighlightedCoordinate(result.coordinate);
          flyToPreviewAnchor(camera, result.coordinate, currentZoom, PREVIEW_FLY_DURATION_MS);
          schedulePreviewActivation(PREVIEW_FLY_DURATION_MS, () => {
            void openClusterPreviewAtCoord(previewIds, result.coordinate);
          });
        } else if (result.bbox) {
          camera.fitBounds(
            [result.bbox.west, result.bbox.south, result.bbox.east, result.bbox.north],
            { padding: 80, duration: 500 },
          );
        } else {
          camera.flyTo({
            center: result.coordinate,
            zoom: Math.min(currentZoom + 2, 18),
            duration: 500,
          });
        }
      }
    },
    [openClusterPreviewAtCoord, schedulePreviewActivation],
  );

  const handleFollowingOverlayPress = useCallback(
    (
      item: FollowingViewportItem,
      currentZoom: number,
      camera: MapCameraCommands,
    ) => {
      const coord = item.coordinate;
      const derivedActivity = derivePreviewActivity({
        socialScore: item.actorCount,
        recentSocialScore: item.actorCount,
        activityScore: item.actorCount,
        hasActiveListing: item.hasActiveListing,
      });

      setHighlightedCoordinate(coord);
      flyToPreviewAnchor(camera, coord, currentZoom, PREVIEW_FLY_DURATION_MS);
      schedulePreviewActivation(PREVIEW_FLY_DURATION_MS, () => {
        setSelectedPropertyId(item.id);
        setPreviewGroup({
          properties: [{
            id: item.id,
            coordinate: coord,
            address: item.address,
            city: item.city,
            postalCode: item.postalCode ?? null,
            countryCode: item.countryCode ?? undefined,
            askingPrice: item.askingPrice ?? null,
            thumbnailUrl: item.thumbnailUrl ?? null,
            hasActiveListing: item.hasActiveListing ?? null,
            marketState: item.marketState ?? null,
            socialScore: derivedActivity.socialScore,
            recentSocialScore: derivedActivity.recentSocialScore,
            lastSocialAt: item.lastActivityAt ?? null,
            activityLevel: derivedActivity.activityLevel,
            activityScore: derivedActivity.activityScore,
            aerialImageUrl: derivePropertyAerialImageUrl({
              geometry: { type: 'Point', coordinates: coord },
              countryCode: item.countryCode ?? undefined,
            }),
          }],
          coordinate: coord,
        });
        setCurrentPreviewIndex(0);
      });
    },
    [schedulePreviewActivation],
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
        clearPreviewSelection();
      }
    }
    // If sheet is expanded (1 or 2), don't close preview
  }, [clearPreviewSelection, previewGroup]);

  // ── Search callbacks ────────────────────────────────────────
  const handlePropertyResolved = useCallback(
    (
      property: PropertyResolveResult,
      camera: MapCameraCommands,
      resolvedAddress?: ResolvedAddress,
    ) => {
      const { lon, lat } = property.coordinates;
      const coord: [number, number] = [lon, lat];
      const countryCode = property.countryCode ?? resolvedAddress?.details.countryCode ?? undefined;
      const derivedActivity = derivePreviewActivity({
        hasActiveListing: property.hasActiveListing,
        bootstrapNeutral: true,
      });
      setHighlightedCoordinate(coord);
      flyToPreviewAnchor(camera, coord, SEARCH_TARGET_ZOOM, SEARCH_PREVIEW_FLY_DURATION_MS);
      schedulePreviewActivation(SEARCH_PREVIEW_FLY_DURATION_MS, () => {
        setSelectedPropertyId(property.id);
        setPreviewGroup({
          properties: [{
            id: property.id,
            coordinate: coord,
            address: property.address,
            streetName: resolvedAddress?.details.street ?? null,
            houseNumber: resolvedAddress?.details.houseNumber ?? null,
            houseNumberAddition: resolvedAddress?.details.houseNumberAddition ?? null,
            city: property.city,
            postalCode: property.postalCode ?? null,
            countryCode,
            officialValuation: property.officialValuation ?? null,
            askingPrice: null,
            hasActiveListing: property.hasActiveListing ?? null,
            marketState: property.marketState ?? null,
            socialScore: derivedActivity.socialScore,
            recentSocialScore: derivedActivity.recentSocialScore,
            activityLevel: derivedActivity.activityLevel,
            activityScore: derivedActivity.activityScore,
            thumbnailUrl: null,
            aerialImageUrl: derivePropertyAerialImageUrl({
              geometry: { type: 'Point', coordinates: coord },
              countryCode,
            }),
          }],
          coordinate: coord,
        });
        setCurrentPreviewIndex(0);
      });
    },
    [schedulePreviewActivation],
  );

  const handleLocationResolved = useCallback(
    (coordinates: { lon: number; lat: number }, _address: string, camera: MapCameraCommands) => {
      camera.flyTo({
        center: [coordinates.lon, coordinates.lat],
        zoom: SEARCH_TARGET_ZOOM,
        duration: 1000,
      });
    },
    [],
  );

  return {
    // Selection state
    selectedPropertyId,
    setSelectedPropertyId,
    highlightedCoordinate,
    setHighlightedCoordinate,
    selectedProperty,
    selectedPropertyForSheet,
    selectedPropertyLoading,

    // Preview group state
    previewGroup,
    setPreviewGroup,
    currentPreviewIndex,
    setCurrentPreviewIndex,

    // Bottom sheet
    bottomSheetRef,
    sheetIndexRef,
    sheetIndex,
    handleSheetIndexChange,
    handleSheetClose,

    // Like / Save
    isLiked,
    isSaved,
    toggleLike,
    toggleSave,

    // Auth modal
    showAuthModal,
    authCopy,
    handleAuthRequired,
    handleAuthModalClose,
    handleAuthSuccess,
    handleAuthStarting,
    resetTransientUI,

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
    handleFollowingOverlayPress,
    handleEmptyMapTap,
    openClusterPreviewAtCoord,

    // Conversion helpers
    toGroupProperty,
  };
}
