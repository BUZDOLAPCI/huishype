import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';

import { GroupPreviewCard } from './GroupPreviewCard';
import type { GroupPreviewCardProps } from './GroupPreviewCard';
import type { PreviewGroup } from '@/src/hooks/useMapInteraction';

interface WebPreviewMarkerPortalProps {
  map: maplibregl.Map | null;
  previewGroup: PreviewGroup | null;
  anchorCoordinate?: [number, number] | null;
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

export function WebPreviewMarkerPortal({
  map,
  previewGroup,
  anchorCoordinate,
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
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [arrowDirection, setArrowDirection] = useState<'up' | 'down'>('down');
  const previewAnchorCoordinate = anchorCoordinate ?? previewGroup?.coordinate ?? null;
  const previewLongitude = previewAnchorCoordinate?.[0] ?? null;
  const previewLatitude = previewAnchorCoordinate?.[1] ?? null;

  useEffect(() => {
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
      previewMarkerRef.current = null;
    }
    setPortalTarget(null);

    if (!map || previewLongitude == null || previewLatitude == null) return;

    const previewCoordinate: [number, number] = [previewLongitude, previewLatitude];

    const screenPoint = map.project(previewCoordinate);
    const cardHeight = 200;
    const bottomMargin = 80;
    const mapContainerHeight = map.getContainer?.().clientHeight ?? 0;
    const viewportHeight =
      mapContainerHeight > 0
        ? mapContainerHeight
        : typeof window !== 'undefined'
          ? window.innerHeight
          : 0;
    const shouldShowBelow =
      viewportHeight <= 0 ||
      viewportHeight - screenPoint.y >= cardHeight + bottomMargin;

    setArrowDirection(shouldShowBelow ? 'up' : 'down');

    const container = document.createElement('div');
    container.style.pointerEvents = 'auto';
    container.style.zIndex = '1000';
    container.style.position = 'absolute';
    container.style.display = 'inline-flex';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.width = 'max-content';
    container.style.overflow = 'visible';
    container.setAttribute('data-testid', 'group-preview-marker-container');

    // Keep pointer interactions inside the card from bubbling back to the map.
    [
      'pointerdown',
      'pointermove',
      'pointerup',
      'mousedown',
      'mousemove',
      'mouseup',
      'click',
      'touchstart',
      'touchmove',
      'touchend',
      'wheel',
      'dblclick',
    ].forEach((eventName) => {
      container.addEventListener(eventName, (event) => event.stopPropagation());
    });

    const marker = new maplibregl.Marker({
      element: container,
      anchor: shouldShowBelow ? 'top' : 'bottom',
      offset: [0, shouldShowBelow ? markerOffsetPx : -markerOffsetPx],
    })
      .setLngLat(previewCoordinate)
      .addTo(map);

    previewMarkerRef.current = marker;
    setPortalTarget(container);

    return () => {
      marker.remove();
      if (previewMarkerRef.current === marker) {
        previewMarkerRef.current = null;
      }
    };
  }, [map, markerOffsetPx, previewLatitude, previewLongitude]);

  if (!portalTarget || !previewGroup) {
    return null;
  }

  return createPortal(
    <div
      style={{
        animation: 'popIn 0.3s ease-out forwards',
        display: 'inline-flex',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
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
        arrowDirection={arrowDirection}
      />
    </div>,
    portalTarget
  );
}
