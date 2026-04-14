import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { GroupPreviewCard } from './GroupPreviewCard';
import type { GroupPreviewCardProps } from './GroupPreviewCard';
import type { PreviewGroup } from '@/src/hooks/useMapInteraction';

interface WebPreviewMarkerPortalProps {
  map: maplibregl.Map | null;
  previewGroup: PreviewGroup | null;
  currentIndex: number;
  markerOffsetPx: number;
  onIndexChange: NonNullable<GroupPreviewCardProps['onIndexChange']>;
  onClose: GroupPreviewCardProps['onClose'];
  onPropertyTap: GroupPreviewCardProps['onPropertyTap'];
  onLike: GroupPreviewCardProps['onLike'];
  onComment: GroupPreviewCardProps['onComment'];
  onGuess: GroupPreviewCardProps['onGuess'];
  isLiked: GroupPreviewCardProps['isLiked'];
}

const PORTAL_HORIZONTAL_MARGIN_PX = 16;
const PORTAL_TOP_MARGIN_PX = 88;
const PORTAL_BOTTOM_MARGIN_PX = 16;
const PORTAL_SHEET_GAP_PX = 12;
const FALLBACK_CARD_WIDTH_PX = 280;
const FALLBACK_CARD_HEIGHT_PX = 260;
const SHEET_INDEX_CHANGE_EVENT = 'huishype:sheet-index-change';

type OverlayPlacement = 'above' | 'below';

interface OverlayPosition {
  x: number;
  y: number;
  placement: OverlayPlacement;
}

interface OverlaySize {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getOverlaySize(element: HTMLDivElement | null): OverlaySize {
  if (!element) {
    return { width: FALLBACK_CARD_WIDTH_PX, height: FALLBACK_CARD_HEIGHT_PX };
  }

  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }

  return { width: FALLBACK_CARD_WIDTH_PX, height: FALLBACK_CARD_HEIGHT_PX };
}

function getSheetTopBoundary(viewportHeight: number): number {
  if (typeof window === 'undefined') {
    return viewportHeight - PORTAL_BOTTOM_MARGIN_PX;
  }

  const sheetIndex = (window as unknown as { __sheetIndex?: number }).__sheetIndex ?? -1;
  if (sheetIndex < 0) {
    return viewportHeight - PORTAL_BOTTOM_MARGIN_PX;
  }

  const panel = document.querySelector('[data-testid="web-property-panel"]') as HTMLElement | null;
  if (!panel) {
    return viewportHeight - PORTAL_BOTTOM_MARGIN_PX;
  }

  const rect = panel.getBoundingClientRect();
  if (!Number.isFinite(rect.top)) {
    return viewportHeight - PORTAL_BOTTOM_MARGIN_PX;
  }

  return Math.max(PORTAL_TOP_MARGIN_PX, rect.top - PORTAL_SHEET_GAP_PX);
}

function computeOverlayPosition(
  screenPoint: { x: number; y: number },
  overlaySize: OverlaySize,
  viewportSize: { width: number; height: number },
  markerOffsetPx: number,
): OverlayPosition {
  const safeWidth = Math.max(0, viewportSize.width);
  const safeHeight = Math.max(0, viewportSize.height);
  const overlayWidth = Math.max(1, overlaySize.width);
  const overlayHeight = Math.max(1, overlaySize.height);

  const centerMin = PORTAL_HORIZONTAL_MARGIN_PX + overlayWidth / 2;
  const centerMax = safeWidth - PORTAL_HORIZONTAL_MARGIN_PX - overlayWidth / 2;
  const x = clamp(screenPoint.x, Math.min(centerMin, centerMax), Math.max(centerMin, centerMax));

  const sheetTopBoundary = getSheetTopBoundary(safeHeight);
  const topMin = PORTAL_TOP_MARGIN_PX;
  const topMax = Math.max(topMin, sheetTopBoundary - overlayHeight);

  const belowTop = screenPoint.y + markerOffsetPx;
  const aboveTop = screenPoint.y - markerOffsetPx - overlayHeight;

  const belowSpace = sheetTopBoundary - belowTop;
  const aboveSpace = aboveTop - topMin;
  const placement: OverlayPlacement =
    belowSpace >= overlayHeight && belowSpace >= aboveSpace
      ? 'below'
      : aboveSpace >= overlayHeight
        ? 'above'
        : (belowSpace >= aboveSpace ? 'below' : 'above');

  const rawTop = placement === 'below' ? belowTop : aboveTop;
  const y = clamp(rawTop, topMin, topMax);

  return { x, y, placement };
}

export function WebPreviewMarkerPortal({
  map,
  previewGroup,
  currentIndex,
  markerOffsetPx,
  onIndexChange,
  onClose,
  onPropertyTap,
  onLike,
  onComment,
  onGuess,
  isLiked,
}: WebPreviewMarkerPortalProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previewLongitude = previewGroup?.coordinate[0] ?? null;
  const previewLatitude = previewGroup?.coordinate[1] ?? null;
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(() => {
    if (typeof window === 'undefined' || !map || previewLongitude == null || previewLatitude == null) {
      return null;
    }

    const previewCoordinate: [number, number] = [previewLongitude, previewLatitude];
    const screenPoint = map.project(previewCoordinate);
    const viewportSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    return computeOverlayPosition(
      screenPoint,
      { width: FALLBACK_CARD_WIDTH_PX, height: FALLBACK_CARD_HEIGHT_PX },
      viewportSize,
      markerOffsetPx,
    );
  });

  useLayoutEffect(() => {
    if (!map || previewLongitude == null || previewLatitude == null) {
      setOverlayPosition(null);
      return;
    }

    const previewCoordinate: [number, number] = [previewLongitude, previewLatitude];
    const updatePosition = () => {
      const screenPoint = map.project(previewCoordinate);
      const overlaySize = getOverlaySize(overlayRef.current);
      const viewportSize = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const nextPosition = computeOverlayPosition(
        screenPoint,
        overlaySize,
        viewportSize,
        markerOffsetPx,
      );

      setOverlayPosition((current) => {
        if (
          current &&
          current.x === nextPosition.x &&
          current.y === nextPosition.y &&
          current.placement === nextPosition.placement
        ) {
          return current;
        }

        return nextPosition;
      });
    };

    updatePosition();
    map.on('move', updatePosition);
    map.on('zoom', updatePosition);
    map.on('rotate', updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener(SHEET_INDEX_CHANGE_EVENT, updatePosition as EventListener);

    const resizeObserver = typeof ResizeObserver !== 'undefined' && overlayRef.current
      ? new ResizeObserver(updatePosition)
      : null;

    if (resizeObserver && overlayRef.current) {
      resizeObserver.observe(overlayRef.current);
    }

    return () => {
      map.off('move', updatePosition);
      map.off('zoom', updatePosition);
      map.off('rotate', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener(SHEET_INDEX_CHANGE_EVENT, updatePosition as EventListener);
      resizeObserver?.disconnect();
    };
  }, [map, markerOffsetPx, previewLatitude, previewLongitude]);

  if (!overlayPosition || !previewGroup) {
    return null;
  }

  return createPortal(
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        left: overlayPosition.x,
        top: overlayPosition.y,
        transform: 'translate(-50%, 0)',
        zIndex: 2500,
        animation: 'popIn 0.3s ease-out forwards',
        display: 'inline-flex',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
      data-testid="group-preview-marker-container"
    >
      <GroupPreviewCard
        properties={previewGroup.properties}
        currentIndex={currentIndex}
        onIndexChange={onIndexChange}
        onClose={onClose}
        onPropertyTap={onPropertyTap}
        onLike={onLike}
        onComment={onComment}
        onGuess={onGuess}
        isLiked={isLiked}
        showArrow
        arrowDirection={overlayPosition.placement === 'below' ? 'up' : 'down'}
      />
    </div>,
    document.body
  );
}
