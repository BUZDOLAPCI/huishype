import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';

import {
  AmbientCommentBubble,
  AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
  AMBIENT_COMMENT_BUBBLE_WIDTH,
  getAmbientCommentBubbleArrowLayout,
} from './AmbientCommentBubble';
import type { AmbientCommentBubble as AmbientCommentBubbleData } from '@/src/hooks/useAmbientCommentBubbles';

type BubblePortalTarget = {
  nodeKey: string;
  container: HTMLDivElement;
  marker: maplibregl.Marker;
  anchor: 'top' | 'bottom';
  arrowDirection: 'up' | 'down';
  arrowHorizontalAlign: 'left' | 'right';
};

interface WebAmbientCommentBubblesPortalProps {
  map: maplibregl.Map | null;
  bubbles: AmbientCommentBubbleData[];
  onBubblePress: (bubble: AmbientCommentBubbleData) => void;
}

export function WebAmbientCommentBubblesPortal({
  map,
  bubbles,
  onBubblePress,
}: WebAmbientCommentBubblesPortalProps) {
  const targetsRef = useRef(new Map<string, BubblePortalTarget>());
  const previousMapRef = useRef<maplibregl.Map | null>(null);
  const [targets, setTargets] = useState<BubblePortalTarget[]>([]);

  useEffect(() => {
    if (previousMapRef.current !== map) {
      for (const target of targetsRef.current.values()) {
        target.marker.remove();
      }
      targetsRef.current.clear();
      previousMapRef.current = map;
    }

    if (!map || bubbles.length === 0) {
      for (const target of targetsRef.current.values()) {
        target.marker.remove();
      }
      targetsRef.current.clear();
      setTargets([]);
      return undefined;
    }

    const nextNodeKeys = new Set<string>();
    const nextTargets = bubbles.map((bubble) => {
      const bubbleAnchorCoordinate = bubble.property.coordinate ?? bubble.coordinate;
      const screenPoint = map.project(bubbleAnchorCoordinate);
      const shouldShowBelow = screenPoint.y < 190;
      const viewportWidth = map.getContainer().clientWidth || window.innerWidth;
      const { anchorOffsetX, arrowHorizontalAlign } = getAmbientCommentBubbleArrowLayout({
        anchorX: screenPoint.x,
        viewportWidth,
      });
      const horizontalOffset = (AMBIENT_COMMENT_BUBBLE_WIDTH / 2) - anchorOffsetX;
      const anchor = shouldShowBelow ? 'top' : 'bottom';
      const offset: [number, number] = [
        horizontalOffset,
        shouldShowBelow
          ? AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX
          : -AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX,
      ];

      const existingTarget = targetsRef.current.get(bubble.nodeKey);

      let target = existingTarget;
      if (!target || target.anchor !== anchor) {
        existingTarget?.marker.remove();

        const container = document.createElement('div');
        container.style.pointerEvents = 'auto';
        container.style.zIndex = '1000';
        // Keep each marker out of normal DOM flow so sibling bubbles do not
        // shift each other's layout before MapLibre applies its transform.
        container.style.position = 'absolute';
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
          anchor,
          offset,
        })
          .setLngLat(bubbleAnchorCoordinate)
          .addTo(map);

        target = {
          nodeKey: bubble.nodeKey,
          container,
          marker,
          anchor,
          arrowDirection: shouldShowBelow ? 'up' : 'down',
          arrowHorizontalAlign,
        };
        targetsRef.current.set(bubble.nodeKey, target);
      } else {
        target.marker
          .setLngLat(bubbleAnchorCoordinate)
          .setOffset(offset);
        target.arrowDirection = shouldShowBelow ? 'up' : 'down';
        target.arrowHorizontalAlign = arrowHorizontalAlign;
      }

      nextNodeKeys.add(bubble.nodeKey);

      return target;
    });

    for (const [nodeKey, target] of targetsRef.current.entries()) {
      if (nextNodeKeys.has(nodeKey)) {
        continue;
      }

      target.marker.remove();
      targetsRef.current.delete(nodeKey);
    }

    setTargets(nextTargets);

    return () => {
      // Markers persist across equivalent bubble refreshes; cleanup happens when
      // a bubble disappears, changes anchor side, the map instance changes, or
      // the component unmounts.
    };
  }, [bubbles, map]);

  useEffect(() => () => {
    for (const target of targetsRef.current.values()) {
      target.marker.remove();
    }
    targetsRef.current.clear();
    previousMapRef.current = null;
  }, []);

  const targetsByNodeKey = useMemo(
    () => new Map(targets.map((target) => [target.nodeKey, target])),
    [targets],
  );

  return (
    <>
      {bubbles.map((bubble) => {
        const target = targetsByNodeKey.get(bubble.nodeKey);
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
              arrowHorizontalAlign={target.arrowHorizontalAlign}
              onPress={() => onBubblePress(bubble)}
              testID={`ambient-comment-bubble-${bubble.property.id}`}
            />
          </div>,
          target.container,
          bubble.nodeKey,
        );
      })}
    </>
  );
}
