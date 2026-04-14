export interface ViewportAnchor {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportOffset {
  x: number;
  y: number;
}

export const PREVIEW_CARD_VIEWPORT_ANCHOR: ViewportAnchor = {
  x: 0.5,
  y: 0.3,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function viewportAnchorToPadding(
  size: ViewportSize,
  anchor: ViewportAnchor,
): ViewportPadding {
  const width = Number.isFinite(size.width) ? Math.max(0, size.width) : 0;
  const height = Number.isFinite(size.height) ? Math.max(0, size.height) : 0;

  if (width === 0 || height === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const x = clamp01(anchor.x);
  const y = clamp01(anchor.y);

  const left = Math.max(0, (2 * x - 1) * width);
  const right = Math.max(0, (1 - 2 * x) * width);
  const top = Math.max(0, (2 * y - 1) * height);
  const bottom = Math.max(0, (1 - 2 * y) * height);

  return {
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
    left: Math.round(left),
  };
}

export function viewportAnchorToOffset(
  size: ViewportSize,
  anchor: ViewportAnchor,
): ViewportOffset {
  const width = Number.isFinite(size.width) ? Math.max(0, size.width) : 0;
  const height = Number.isFinite(size.height) ? Math.max(0, size.height) : 0;

  if (width === 0 || height === 0) {
    return { x: 0, y: 0 };
  }

  const x = clamp01(anchor.x);
  const y = clamp01(anchor.y);

  return {
    x: Math.round((x - 0.5) * width),
    y: Math.round((y - 0.5) * height),
  };
}
