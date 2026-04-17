import {
  getNativePreviewOverlayLayout,
  isNativePreviewAnchorVisible,
} from '../nativePreviewOverlay';

describe('nativePreviewOverlay', () => {
  const viewportSize = { width: 400, height: 800 };
  const topBoundary = 148;

  describe('isNativePreviewAnchorVisible', () => {
    it('returns true when the anchor is inside the usable viewport', () => {
      expect(
        isNativePreviewAnchorVisible({
          anchorPoint: [200, 300],
          topBoundary,
          viewportSize,
        }),
      ).toBe(true);
    });

    it('returns false when the anchor is outside the usable bounds', () => {
      expect(
        isNativePreviewAnchorVisible({
          anchorPoint: [10, 300],
          topBoundary,
          viewportSize,
        }),
      ).toBe(false);

      expect(
        isNativePreviewAnchorVisible({
          anchorPoint: [390, 300],
          topBoundary,
          viewportSize,
        }),
      ).toBe(false);

      expect(
        isNativePreviewAnchorVisible({
          anchorPoint: [200, 140],
          topBoundary,
          viewportSize,
        }),
      ).toBe(false);

      expect(
        isNativePreviewAnchorVisible({
          anchorPoint: [200, 789],
          topBoundary,
          viewportSize,
        }),
      ).toBe(false);
    });
  });

  describe('getNativePreviewOverlayLayout', () => {
    it('returns null when the anchor is not visible', () => {
      expect(
        getNativePreviewOverlayLayout({
          anchorPoint: [200, 140],
          cardSize: { width: 280, height: 120 },
          topBoundary,
          viewportSize,
        }),
      ).toBeNull();
    });

    it('places the card above the anchor when space is available', () => {
      expect(
        getNativePreviewOverlayLayout({
          anchorPoint: [380, 350],
          cardSize: { width: 280, height: 160 },
          topBoundary,
          viewportSize,
        }),
      ).toEqual({
        arrowDirection: 'down',
        left: 108,
        top: 190,
      });
    });

    it('places the card below the anchor when there is not enough room above', () => {
      expect(
        getNativePreviewOverlayLayout({
          anchorPoint: [200, 200],
          cardSize: { width: 280, height: 120 },
          topBoundary,
          viewportSize,
        }),
      ).toEqual({
        arrowDirection: 'up',
        left: 60,
        top: 200,
      });
    });

    it('can anchor the card from a custom point instead of its horizontal center', () => {
      expect(
        getNativePreviewOverlayLayout({
          anchorPoint: [140, 350],
          anchorOffsetX: 35,
          cardSize: { width: 236, height: 64 },
          topBoundary,
          viewportSize,
        }),
      ).toEqual({
        arrowDirection: 'down',
        left: 105,
        top: 286,
      });
    });
  });
});
