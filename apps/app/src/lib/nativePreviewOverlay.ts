export type NativePreviewLayout = {
  arrowDirection: 'up' | 'down';
  left: number;
  top: number;
};

const DEFAULT_PREVIEW_OVERLAY_MARGIN = 12;
const DEFAULT_PREVIEW_FALLBACK_WIDTH = 280;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function isNativePreviewAnchorVisible(params: {
  anchorPoint: [number, number];
  topBoundary: number;
  viewportSize: { width: number; height: number };
  margin?: number;
}): boolean {
  const {
    anchorPoint,
    topBoundary,
    viewportSize,
    margin = DEFAULT_PREVIEW_OVERLAY_MARGIN,
  } = params;
  const viewportWidth = Math.max(viewportSize.width, 0);
  const viewportHeight = Math.max(viewportSize.height, 0);
  const minX = margin;
  const maxX = viewportWidth - margin;
  const minY = Math.max(topBoundary, margin);
  const maxY = viewportHeight - margin;

  if (
    !Number.isFinite(anchorPoint[0]) ||
    !Number.isFinite(anchorPoint[1]) ||
    maxX < minX ||
    maxY < minY
  ) {
    return false;
  }

  return (
    anchorPoint[0] >= minX &&
    anchorPoint[0] <= maxX &&
    anchorPoint[1] >= minY &&
    anchorPoint[1] <= maxY
  );
}

export function getNativePreviewOverlayLayout(params: {
  anchorPoint: [number, number];
  anchorOffsetX?: number;
  cardSize: { width: number; height: number };
  topBoundary: number;
  viewportSize: { width: number; height: number };
  fallbackWidth?: number;
  margin?: number;
}): NativePreviewLayout | null {
  const {
    anchorPoint,
    anchorOffsetX,
    cardSize,
    topBoundary,
    viewportSize,
    fallbackWidth = DEFAULT_PREVIEW_FALLBACK_WIDTH,
    margin = DEFAULT_PREVIEW_OVERLAY_MARGIN,
  } = params;
  const viewportWidth = Math.max(viewportSize.width, 0);

  if (!isNativePreviewAnchorVisible({ anchorPoint, topBoundary, viewportSize, margin })) {
    return null;
  }

  const cardWidth = cardSize.width > 0 ? cardSize.width : fallbackWidth;
  const resolvedAnchorOffsetX =
    anchorOffsetX == null ? cardWidth / 2 : clamp(anchorOffsetX, 0, cardWidth);
  const maxLeft = Math.max(
    margin,
    viewportWidth - cardWidth - margin,
  );

  return {
    arrowDirection: 'up',
    left: clamp(
      anchorPoint[0] - resolvedAnchorOffsetX,
      margin,
      maxLeft,
    ),
    top: anchorPoint[1],
  };
}
