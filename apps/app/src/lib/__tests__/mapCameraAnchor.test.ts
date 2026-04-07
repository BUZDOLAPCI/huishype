import {
  PREVIEW_CARD_VIEWPORT_ANCHOR,
  viewportAnchorToPadding,
  viewportAnchorToOffset,
} from '../mapCameraAnchor';

describe('mapCameraAnchor', () => {
  it('returns no padding for a centered anchor', () => {
    expect(
      viewportAnchorToPadding(
        { width: 400, height: 800 },
        { x: 0.5, y: 0.5 },
      ),
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('biases padding toward the bottom when the target anchor is above center', () => {
    expect(
      viewportAnchorToPadding(
        { width: 400, height: 800 },
        PREVIEW_CARD_VIEWPORT_ANCHOR,
      ),
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 320,
      left: 0,
    });
  });

  it('converts the preview anchor to a native MapLibre flyTo offset', () => {
    expect(
      viewportAnchorToOffset(
        { width: 400, height: 800 },
        PREVIEW_CARD_VIEWPORT_ANCHOR,
      ),
    ).toEqual({
      x: 0,
      y: -160,
    });
  });

  it('biases padding toward the top when the target anchor is below center', () => {
    expect(
      viewportAnchorToPadding(
        { width: 400, height: 800 },
        { x: 0.5, y: 0.65 },
      ),
    ).toEqual({
      top: 240,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('clamps invalid anchors and empty viewports to safe values', () => {
    expect(
      viewportAnchorToPadding(
        { width: 0, height: 800 },
        { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      ),
    ).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    expect(
      viewportAnchorToOffset(
        { width: 0, height: 800 },
        { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      ),
    ).toEqual({
      x: 0,
      y: 0,
    });
  });
});
