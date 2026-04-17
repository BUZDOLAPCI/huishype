import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import {
  getAmbientCommentRotationWindow,
  rankAmbientCommentCandidates,
} from '@/src/lib/ambientCommentBubbles';
import { apiFetch } from '@/src/utils/api';

const HYDRATION_POOL_SIZE = 5;
const ROTATION_INTERVAL_MS = 5000;
const CACHE_TTL_MS = 3 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 45 * 1000;
const COMMENT_FETCH_LIMIT = 4;
const SHORT_COMMENT_MAX_LENGTH = 72;

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
  property: GroupPreviewProperty;
  coordinate: [number, number];
  screenPoint: [number, number] | null;
  commentCount: number;
  likeCount: number;
  activityScore: number;
  hasListing: boolean;
  nodeClass: 'active' | 'ghost';
}

export interface AmbientCommentBubble {
  property: GroupPreviewProperty;
  coordinate: [number, number];
  screenPoint: [number, number] | null;
  preview: AmbientCommentPreview;
}

interface UseAmbientCommentBubblesOptions {
  enabled: boolean;
  maxVisibleBubbles?: number;
}

interface CommentPreviewCacheEntry {
  expiresAt: number;
  preview: AmbientCommentPreview | null;
  promise: Promise<AmbientCommentPreview | null> | null;
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

export function useAmbientCommentBubbles({
  enabled,
  maxVisibleBubbles = 2,
}: UseAmbientCommentBubblesOptions) {
  const [hydratedBubbles, setHydratedBubbles] = useState<AmbientCommentBubble[]>([]);
  const [rotationIndex, setRotationIndex] = useState(0);

  const cacheRef = useRef(new Map<string, CommentPreviewCacheEntry>());
  const requestIdRef = useRef(0);

  const clearBubbles = useCallback(() => {
    requestIdRef.current += 1;
    setHydratedBubbles([]);
    setRotationIndex(0);
  }, []);

  const getCachedPreview = useCallback(async (propertyId: string) => {
    const now = Date.now();
    const currentEntry = cacheRef.current.get(propertyId);

    if (currentEntry && currentEntry.expiresAt > now) {
      if (currentEntry.promise) {
        return currentEntry.promise;
      }
      return currentEntry.preview;
    }

    const request = fetchAmbientCommentPreview(propertyId).then((preview) => {
      cacheRef.current.set(propertyId, {
        expiresAt: Date.now() + (preview ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS),
        preview,
        promise: null,
      });
      return preview;
    });

    cacheRef.current.set(propertyId, {
      expiresAt: now + CACHE_TTL_MS,
      preview: currentEntry?.preview ?? null,
      promise: request,
    });

    return request;
  }, []);

  const refreshBubbles = useCallback(async (visibleNodes: AmbientBubbleVisibleNode[]) => {
    if (!enabled) {
      clearBubbles();
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const nodesByPropertyId = new Map(
      visibleNodes.map((node) => [node.property.id, node] as const),
    );
    const rankedNodes = rankAmbientCommentCandidates(
      visibleNodes.map((node) => ({
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
      HYDRATION_POOL_SIZE,
    );

    if (rankedNodes.length === 0) {
      setHydratedBubbles([]);
      setRotationIndex(0);
      return;
    }

    const hydrated = await Promise.all(
      rankedNodes.map(async (candidate) => {
        const node = nodesByPropertyId.get(candidate.propertyId);
        if (!node) {
          return null;
        }

        const preview = await getCachedPreview(candidate.propertyId);
        if (!preview) {
          return null;
        }

        return {
          property: node.property,
          coordinate: node.coordinate,
          screenPoint: node.screenPoint,
          preview,
        } satisfies AmbientCommentBubble;
      }),
    );

    if (requestIdRef.current !== requestId) {
      return;
    }

    const nextHydratedBubbles = hydrated.filter(
      (bubble): bubble is AmbientCommentBubble => bubble !== null,
    );

    setHydratedBubbles(nextHydratedBubbles);
    setRotationIndex((current) => {
      if (nextHydratedBubbles.length <= maxVisibleBubbles) {
        return 0;
      }

      return current + Math.floor(Math.random() * nextHydratedBubbles.length);
    });
  }, [clearBubbles, enabled, getCachedPreview, maxVisibleBubbles]);

  useEffect(() => {
    if (!enabled) {
      clearBubbles();
    }
  }, [clearBubbles, enabled]);

  useEffect(() => {
    if (!enabled || hydratedBubbles.length <= maxVisibleBubbles) {
      return undefined;
    }

    const interval = setInterval(() => {
      setRotationIndex((currentIndex) => currentIndex + 1);
    }, ROTATION_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [enabled, hydratedBubbles.length, maxVisibleBubbles]);

  const bubbles = useMemo(
    () => getAmbientCommentRotationWindow(
      hydratedBubbles,
      rotationIndex,
      Math.min(maxVisibleBubbles, hydratedBubbles.length),
    ),
    [hydratedBubbles, maxVisibleBubbles, rotationIndex],
  );

  return {
    bubbles,
    clearBubbles,
    refreshBubbles,
  };
}
