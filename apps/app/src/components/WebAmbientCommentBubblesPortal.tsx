import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';

import { AmbientCommentBubble, AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX } from './AmbientCommentBubble';
import type { GroupPreviewProperty } from './GroupPreviewCard';
import type { AmbientCommentBubble as AmbientCommentBubbleData } from '@/src/hooks/useAmbientCommentBubbles';

type BubblePortalTarget = {
  propertyId: string;
  container: HTMLDivElement;
  arrowDirection: 'up' | 'down';
};

interface WebAmbientCommentBubblesPortalProps {
  map: maplibregl.Map | null;
  bubbles: AmbientCommentBubbleData[];
  onBubblePress: (property: GroupPreviewProperty) => void;
}

export function WebAmbientCommentBubblesPortal({
  map,
  bubbles,
  onBubblePress,
}: WebAmbientCommentBubblesPortalProps) {
  const [targets, setTargets] = useState<BubblePortalTarget[]>([]);

  useEffect(() => {
    const markers: maplibregl.Marker[] = [];

    if (!map || bubbles.length === 0) {
      setTargets([]);
      return undefined;
    }

    const nextTargets = bubbles.map((bubble) => {
      const screenPoint = map.project(bubble.coordinate);
      const shouldShowBelow = screenPoint.y < 190;
      const container = document.createElement('div');
      container.style.pointerEvents = 'auto';
      container.style.zIndex = '1000';
      container.style.position = 'relative';
      container.style.display = 'inline-flex';
      container.style.justifyContent = 'center';
      container.style.alignItems = 'center';
      container.style.width = 'max-content';
      container.style.overflow = 'visible';
      container.dataset.testid = `ambient-comment-bubble-marker-${bubble.property.id}`;

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
        offset: [
          0,
          shouldShowBelow
            ? AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX
            : -AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
        ],
      })
        .setLngLat(bubble.coordinate)
        .addTo(map);

      markers.push(marker);

      return {
        propertyId: bubble.property.id,
        container,
        arrowDirection: shouldShowBelow ? 'up' : 'down',
      } satisfies BubblePortalTarget;
    });

    setTargets(nextTargets);

    return () => {
      for (const marker of markers) {
        marker.remove();
      }
    };
  }, [bubbles, map]);

  const targetsByPropertyId = useMemo(
    () => new Map(targets.map((target) => [target.propertyId, target])),
    [targets],
  );

  return (
    <>
      {bubbles.map((bubble) => {
        const target = targetsByPropertyId.get(bubble.property.id);
        if (!target) {
          return null;
        }

        return createPortal(
          <div style={{ animation: 'popIn 0.28s ease-out forwards', pointerEvents: 'auto' }}>
            <AmbientCommentBubble
              text={bubble.preview.text}
              likeCount={bubble.preview.likeCount}
              authorName={bubble.preview.authorName}
              authorPhotoUrl={bubble.preview.authorPhotoUrl}
              arrowDirection={target.arrowDirection}
              onPress={() => onBubblePress(bubble.property)}
              testID={`ambient-comment-bubble-${bubble.property.id}`}
            />
          </div>,
          target.container,
        );
      })}
    </>
  );
}
