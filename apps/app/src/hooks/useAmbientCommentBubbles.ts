import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import {
  AMBIENT_COMMENT_BUBBLE_HEIGHT,
  AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
  AMBIENT_COMMENT_BUBBLE_WIDTH,
  getAmbientCommentBubbleArrowLayout,
} from '@/src/components/AmbientCommentBubble';
import {
  getAmbientCommentRotationWindow,
  rankAmbientCommentCandidates,
} from '@/src/lib/ambientCommentBubbles';
import { getNativePreviewOverlayLayout } from '@/src/lib/nativePreviewOverlay';
import {
  apiFetch,
  fetchBatchProperties,
  type BatchProperty,
} from '@/src/utils/api';

const HYDRATION_POOL_SIZE = 5;
const ROTATION_INTERVAL_MS = 5000;
const CACHE_TTL_MS = 3 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 45 * 1000;
const COMMENT_FETCH_LIMIT = 4;
const SHORT_COMMENT_MAX_LENGTH = 72;
const DEFAULT_BUBBLE_MINIMUM_GAP_PX = 18;

interface AmbientCommentUser {
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
}

interface AmbientCommentResponse {
  data: Array<{
    id: string;
    content: string;
    likeCount: number;
    user: AmbientCommentUser | null;
  }>;
}

interface AmbientCommentPreview {
  text: string;
  likeCount: number;
  authorName: string;
  authorPhotoUrl: string | null;
}

export interface AmbientBubbleVisibleNode {
  nodeKey: string;
  property: GroupPreviewProperty;
  coordinate: [number, number];
  screenPoint: [number, number] | null;
  commentCount: number;
  likeCount: number;
  activityScore: number;
  hasListing: boolean;
  nodeClass: 'active';
  candidatePropertyIds: string[];
}

export interface AmbientCommentBubble {
  nodeKey: string;
  property: GroupPreviewProperty;
  coordinate: [number, number];
  screenPoint: [number, number] | null;
  preview: AmbientCommentPreview;
}

export interface RefreshAmbientCommentBubblesOptions {
  appendToExisting?: boolean;
  minimumVisibleCount?: number;
  preserveRotation?: boolean;
  placementContext?: AmbientBubblePlacementContext;
}

interface UseAmbientCommentBubblesOptions {
  enabled: boolean;
  maxVisibleBubbles?: number;
  toGroupProperty: (property: BatchProperty, activityScore?: number) => GroupPreviewProperty;
}

interface CommentPreviewCacheEntry {
  expiresAt: number;
  preview: AmbientCommentPreview | null;
  promise: Promise<AmbientCommentPreview | null> | null;
}

interface PropertyCacheEntry {
  expiresAt: number;
  property: BatchProperty | null;
}

export interface AmbientBubblePlacementContext {
  viewportSize: { width: number; height: number };
  topBoundary?: number;
  minimumGapPx?: number;
}

interface BubbleScreenBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getBubbleScreenBounds(
  screenPoint: [number, number] | null,
  placementContext: AmbientBubblePlacementContext,
): BubbleScreenBounds | null {
  if (!screenPoint) {
    return null;
  }

  const { viewportSize, topBoundary } = placementContext;
  if (viewportSize.width <= 0 || viewportSize.height <= 0) {
    return null;
  }

  const arrowLayout = getAmbientCommentBubbleArrowLayout({
    anchorX: screenPoint[0],
    viewportWidth: viewportSize.width,
  });

  if (topBoundary !== undefined) {
    const nativeLayout = getNativePreviewOverlayLayout({
      anchorPoint: screenPoint,
      anchorOffsetX: arrowLayout.anchorOffsetX,
      cardSize: {
        width: AMBIENT_COMMENT_BUBBLE_WIDTH,
        height: AMBIENT_COMMENT_BUBBLE_HEIGHT,
      },
      topBoundary,
      viewportSize,
    });

    if (!nativeLayout) {
      return null;
    }

    return {
      left: nativeLayout.left,
      right: nativeLayout.left + AMBIENT_COMMENT_BUBBLE_WIDTH,
      top: nativeLayout.top,
      bottom: nativeLayout.top + AMBIENT_COMMENT_BUBBLE_HEIGHT,
    };
  }

  const top =
    screenPoint[1] < 190
      ? screenPoint[1] + AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX
      : screenPoint[1] - AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX - AMBIENT_COMMENT_BUBBLE_HEIGHT;
  const left = screenPoint[0] - arrowLayout.anchorOffsetX;

  return {
    left,
    right: left + AMBIENT_COMMENT_BUBBLE_WIDTH,
    top,
    bottom: top + AMBIENT_COMMENT_BUBBLE_HEIGHT,
  };
}

function doBubbleBoundsConflict(
  left: BubbleScreenBounds,
  right: BubbleScreenBounds,
  minimumGapPx: number,
): boolean {
  return !(
    left.right + minimumGapPx <= right.left ||
    right.right + minimumGapPx <= left.left ||
    left.bottom + minimumGapPx <= right.top ||
    right.bottom + minimumGapPx <= left.top
  );
}

function toAmbientCommentPreview(
  comment: AmbientCommentResponse['data'][number] | null | undefined,
): AmbientCommentPreview | null {
  const trimmedContent = comment?.content?.trim();
  if (!trimmedContent) {
    return null;
  }

  return {
    text: trimmedContent,
    likeCount: comment?.likeCount ?? 0,
    authorName:
      comment?.user?.displayName?.trim() ||
      comment?.user?.username ||
      'HuisHype',
    authorPhotoUrl: comment?.user?.profilePhotoUrl ?? null,
  };
}

function isEligibleAmbientComment(comment: AmbientCommentResponse['data'][number]): boolean {
  const content = comment.content?.trim();
  return Boolean(content) && content.length <= SHORT_COMMENT_MAX_LENGTH;
}

function pickAmbientCommentPreview(
  propertyId: string,
  popularResponse: AmbientCommentResponse,
  recentResponse: AmbientCommentResponse,
): AmbientCommentPreview | null {
  const candidates = [popularResponse, recentResponse]
    .flatMap((response) => response.data)
    .filter(isEligibleAmbientComment);

  if (candidates.length === 0) {
    return null;
  }

  const uniqueCandidates = candidates.filter((candidate, index, array) =>
    array.findIndex((entry) => entry.id === candidate.id) === index,
  );
  const seed =
    propertyId.split('').reduce((total, char) => total + char.charCodeAt(0), 0) +
    Math.floor(Date.now() / CACHE_TTL_MS);
  const selectedCandidate = uniqueCandidates[seed % uniqueCandidates.length];

  return toAmbientCommentPreview(selectedCandidate);
}

async function fetchAmbientCommentPreview(propertyId: string): Promise<AmbientCommentPreview | null> {
  try {
    const [popularResponse, recentResponse] = await Promise.all([
      apiFetch<AmbientCommentResponse>(
        `/properties/${propertyId}/comments?limit=${COMMENT_FETCH_LIMIT}&sort=popular`,
      ),
      apiFetch<AmbientCommentResponse>(
        `/properties/${propertyId}/comments?limit=${COMMENT_FETCH_LIMIT}&sort=recent`,
      ),
    ]);
    return pickAmbientCommentPreview(propertyId, popularResponse, recentResponse);
  } catch (error) {
    if (__DEV__) {
      console.warn('[HuisHype] Ambient comment preview fetch failed:', error);
    }
    return null;
  }
}

export function toAmbientBubbleVisibleNode(node: AmbientBubbleVisibleNode): AmbientBubbleVisibleNode {
  return node;
}

function mergeAmbientCommentBubblePool(
  currentBubbles: AmbientCommentBubble[],
  nextBubbles: AmbientCommentBubble[],
): AmbientCommentBubble[] {
  if (nextBubbles.length === 0) {
    return currentBubbles;
  }

  const mergedBubbles = currentBubbles.slice();
  const indexByNodeKey = new Map(
    currentBubbles.map((bubble, index) => [bubble.nodeKey, index] as const),
  );

  for (const bubble of nextBubbles) {
    const existingIndex = indexByNodeKey.get(bubble.nodeKey);
    if (existingIndex === undefined) {
      indexByNodeKey.set(bubble.nodeKey, mergedBubbles.length);
      mergedBubbles.push(bubble);
      continue;
    }

    mergedBubbles[existingIndex] = bubble;
  }

  if (mergedBubbles.length <= HYDRATION_POOL_SIZE) {
    return mergedBubbles;
  }

  return mergedBubbles.slice(-HYDRATION_POOL_SIZE);
}

export function useAmbientCommentBubbles({
  enabled,
  maxVisibleBubbles = 2,
  toGroupProperty,
}: UseAmbientCommentBubblesOptions) {
  const [hydratedBubbles, setHydratedBubbles] = useState<AmbientCommentBubble[]>([]);
  const [rotationStep, setRotationStep] = useState(0);

  const previewCacheRef = useRef(new Map<string, CommentPreviewCacheEntry>());
  const propertyCacheRef = useRef(new Map<string, PropertyCacheEntry>());
  const hydratedBubblesRef = useRef<AmbientCommentBubble[]>([]);
  const requestIdRef = useRef(0);
  const rotationDeadlineRef = useRef<number | null>(null);
  hydratedBubblesRef.current = hydratedBubbles;

  const clearBubbles = useCallback(() => {
    requestIdRef.current += 1;
    setHydratedBubbles([]);
    setRotationStep(0);
    rotationDeadlineRef.current = null;
  }, []);

  const getCachedPreview = useCallback(async (propertyId: string) => {
    const now = Date.now();
    const currentEntry = previewCacheRef.current.get(propertyId);

    if (currentEntry && currentEntry.expiresAt > now) {
      if (currentEntry.promise) {
        return currentEntry.promise;
      }
      return currentEntry.preview;
    }

    const request = fetchAmbientCommentPreview(propertyId).then((preview) => {
      previewCacheRef.current.set(propertyId, {
        expiresAt: Date.now() + (preview ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS),
        preview,
        promise: null,
      });
      return preview;
    });

    previewCacheRef.current.set(propertyId, {
      expiresAt: now + CACHE_TTL_MS,
      preview: currentEntry?.preview ?? null,
      promise: request,
    });

    return request;
  }, []);

  const getCachedProperties = useCallback(async (propertyIds: string[]) => {
    const now = Date.now();
    const uniquePropertyIds = Array.from(new Set(propertyIds.filter(Boolean)));
    const hydratedProperties = new Map<string, BatchProperty>();
    const missingPropertyIds: string[] = [];

    for (const propertyId of uniquePropertyIds) {
      const cachedEntry = propertyCacheRef.current.get(propertyId);
      if (cachedEntry && cachedEntry.expiresAt > now) {
        if (cachedEntry.property) {
          hydratedProperties.set(propertyId, cachedEntry.property);
        }
        continue;
      }

      missingPropertyIds.push(propertyId);
    }

    if (missingPropertyIds.length === 0) {
      return hydratedProperties;
    }

    try {
      const fetchedProperties = await fetchBatchProperties(missingPropertyIds);
      const fetchedPropertyIds = new Set<string>();

      for (const property of fetchedProperties) {
        fetchedPropertyIds.add(property.id);
        propertyCacheRef.current.set(property.id, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          property,
        });
        hydratedProperties.set(property.id, property);
      }

      for (const propertyId of missingPropertyIds) {
        if (fetchedPropertyIds.has(propertyId)) {
          continue;
        }

        propertyCacheRef.current.set(propertyId, {
          expiresAt: Date.now() + EMPTY_CACHE_TTL_MS,
          property: null,
        });
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[HuisHype] Ambient bubble property hydration failed:', error);
      }
    }

    return hydratedProperties;
  }, []);

  const hydrateBubbleForNode = useCallback(async (
    node: AmbientBubbleVisibleNode,
  ): Promise<AmbientCommentBubble | null> => {
    const candidatePropertyIds = Array.from(
      new Set(
        (node.candidatePropertyIds.length > 0
          ? node.candidatePropertyIds
          : [node.property.id]
        ).filter(Boolean),
      ),
    ).slice(0, COMMENT_FETCH_LIMIT);

    if (candidatePropertyIds.length === 0) {
      return null;
    }

    const hydratedProperties = candidatePropertyIds.length > 1
      ? await getCachedProperties(candidatePropertyIds)
      : new Map<string, BatchProperty>();

    const rankedPropertyIds = rankAmbientCommentCandidates(
      candidatePropertyIds.map((propertyId) => {
        const property = hydratedProperties.get(propertyId);
        return {
          nodeKey: propertyId,
          propertyId,
          coordinate: property?.geometry?.coordinates ?? node.coordinate,
          address:
            property?.address ??
            (propertyId === node.property.id ? node.property.address : null),
          city:
            property?.city ??
            (propertyId === node.property.id ? node.property.city : null),
          postalCode:
            property?.postalCode ??
            (propertyId === node.property.id ? node.property.postalCode ?? null : null),
          countryCode:
            property?.countryCode ??
            (propertyId === node.property.id ? node.property.countryCode ?? null : null),
          commentCount:
            property?.commentCount ??
            (propertyId === node.property.id ? node.commentCount : 0),
          likeCount:
            property?.likeCount ??
            (propertyId === node.property.id ? node.likeCount : 0),
          activityScore:
            property?.activityScore ??
            (propertyId === node.property.id ? node.activityScore : 0),
        };
      }),
      candidatePropertyIds.length,
    ).map((candidate) => candidate.propertyId);

    const orderedPropertyIds = [
      ...rankedPropertyIds,
      ...candidatePropertyIds.filter((propertyId) => !rankedPropertyIds.includes(propertyId)),
    ];

    for (const propertyId of orderedPropertyIds) {
      const preview = await getCachedPreview(propertyId);
      if (!preview) {
        continue;
      }

      const hydratedProperty = hydratedProperties.get(propertyId);
      const property = hydratedProperty
        ? toGroupProperty(hydratedProperty, hydratedProperty.activityScore)
        : {
            ...node.property,
            id: propertyId,
          };

      return {
        nodeKey: node.nodeKey,
        property: {
          ...property,
          coordinate: property.coordinate ?? hydratedProperty?.geometry?.coordinates ?? node.coordinate,
        },
        coordinate: node.coordinate,
        screenPoint: node.screenPoint,
        preview,
      };
    }

    return null;
  }, [getCachedPreview, getCachedProperties, toGroupProperty]);

  const refreshBubbles = useCallback(async (
    visibleNodes: AmbientBubbleVisibleNode[],
    options?: RefreshAmbientCommentBubblesOptions,
  ) => {
    if (!enabled) {
      clearBubbles();
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const nodesByKey = new Map(
      visibleNodes.map((node) => [node.nodeKey, node] as const),
    );
    const rankedNodeCandidates = rankAmbientCommentCandidates(
      visibleNodes.map((node) => ({
        nodeKey: node.nodeKey,
        propertyId: node.property.id,
        coordinate: node.coordinate,
        address: node.property.address,
        city: node.property.city,
        postalCode: node.property.postalCode ?? null,
        countryCode: node.property.countryCode ?? null,
        commentCount: node.commentCount,
        likeCount: node.likeCount,
        activityScore: node.activityScore,
      })),
      visibleNodes.length,
    );

    if (rankedNodeCandidates.length === 0) {
      if (options?.appendToExisting) {
        if (options.minimumVisibleCount && options.minimumVisibleCount > 0) {
          setRotationStep((currentStep) =>
            Math.max(currentStep, options.minimumVisibleCount! - 1),
          );
        }
        return;
      }

      setHydratedBubbles([]);
      setRotationStep(0);
      rotationDeadlineRef.current = null;
      return;
    }

    const currentHydratedBubbles = hydratedBubblesRef.current;
    const placementContext = options?.placementContext;
    const minimumGapPx = placementContext?.minimumGapPx ?? DEFAULT_BUBBLE_MINIMUM_GAP_PX;
    const existingBubbleNodeKeys = new Set(
      options?.appendToExisting
        ? currentHydratedBubbles.map((bubble) => bubble.nodeKey)
        : [],
    );
    const blockingBounds = options?.appendToExisting && placementContext
      ? currentHydratedBubbles.flatMap((bubble) => {
          const liveNode = nodesByKey.get(bubble.nodeKey);
          if (!liveNode?.screenPoint) {
            return [];
          }

          const bounds = getBubbleScreenBounds(liveNode.screenPoint, placementContext);
          if (!bounds) {
            return [];
          }

          return [{ nodeKey: bubble.nodeKey, bounds }] as const;
        })
      : [];
    const selectedNodes: AmbientBubbleVisibleNode[] = [];
    const selectedBubbleBounds: BubbleScreenBounds[] = [];

    for (const candidate of rankedNodeCandidates) {
      if (selectedNodes.length >= HYDRATION_POOL_SIZE) {
        break;
      }

      const node = nodesByKey.get(candidate.nodeKey ?? candidate.propertyId);
      if (!node) {
        continue;
      }

      if (!placementContext) {
        selectedNodes.push(node);
        continue;
      }

      const bounds = getBubbleScreenBounds(node.screenPoint, placementContext);
      if (!bounds) {
        if (existingBubbleNodeKeys.has(node.nodeKey)) {
          selectedNodes.push(node);
        }
        continue;
      }

      if (!existingBubbleNodeKeys.has(node.nodeKey)) {
        const conflictsWithExisting = blockingBounds.some((blockingBubble) =>
          doBubbleBoundsConflict(bounds, blockingBubble.bounds, minimumGapPx),
        );
        if (conflictsWithExisting) {
          continue;
        }
      }

      const conflictsWithSelected = selectedBubbleBounds.some((selectedBounds) =>
        doBubbleBoundsConflict(bounds, selectedBounds, minimumGapPx),
      );
      if (conflictsWithSelected) {
        continue;
      }

      selectedNodes.push(node);
      selectedBubbleBounds.push(bounds);
    }

    const hydrated = await Promise.all(
      selectedNodes.map(async (node) => hydrateBubbleForNode(node)),
    );

    if (requestIdRef.current !== requestId) {
      return;
    }

    const nextHydratedBubbles = hydrated.filter(
      (bubble): bubble is AmbientCommentBubble => bubble !== null,
    );

    if (options?.appendToExisting) {
      setHydratedBubbles((currentBubbles) =>
        mergeAmbientCommentBubblePool(currentBubbles, nextHydratedBubbles),
      );
    } else {
      setHydratedBubbles(nextHydratedBubbles);
    }

    if (!options?.preserveRotation && !options?.minimumVisibleCount) {
      setRotationStep(0);
      return;
    }

    setRotationStep((currentStep) => {
      const baseStep = options?.preserveRotation ? currentStep : 0;
      const minimumVisibleStep =
        options?.minimumVisibleCount && options.minimumVisibleCount > 0
          ? options.minimumVisibleCount - 1
          : 0;

      return Math.max(baseStep, minimumVisibleStep);
    });
  }, [clearBubbles, enabled, hydrateBubbleForNode]);

  useEffect(() => {
    if (!enabled) {
      clearBubbles();
    }
  }, [clearBubbles, enabled]);

  useEffect(() => {
    if (!enabled || hydratedBubbles.length <= 1) {
      rotationDeadlineRef.current = null;
      return undefined;
    }

    rotationDeadlineRef.current = Date.now() + ROTATION_INTERVAL_MS;
    const interval = setInterval(() => {
      rotationDeadlineRef.current = Date.now() + ROTATION_INTERVAL_MS;
      setRotationStep((currentStep) => currentStep + 1);
    }, ROTATION_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      rotationDeadlineRef.current = null;
    };
  }, [enabled, hydratedBubbles.length]);

  const getMillisecondsUntilNextRotation = useCallback(() => {
    const nextDeadline = rotationDeadlineRef.current;
    if (nextDeadline === null) {
      return ROTATION_INTERVAL_MS;
    }

    return Math.max(0, nextDeadline - Date.now());
  }, []);

  const bubbles = useMemo(
    () => getAmbientCommentRotationWindow(
      hydratedBubbles,
      rotationStep,
      maxVisibleBubbles,
    ),
    [hydratedBubbles, maxVisibleBubbles, rotationStep],
  );

  return {
    bubbles,
    clearBubbles,
    refreshBubbles,
    getMillisecondsUntilNextRotation,
  };
}
