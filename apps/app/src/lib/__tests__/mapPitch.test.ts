import { AUTO_PITCH_END_ZOOM, AUTO_PITCH_START_ZOOM, getPitchForZoom } from '../mapPitch';

describe('mapPitch', () => {
  it('stays flat through the transition start zoom', () => {
    expect(getPitchForZoom(AUTO_PITCH_START_ZOOM - 2)).toBe(0);
    expect(getPitchForZoom(AUTO_PITCH_START_ZOOM)).toBe(0);
  });

  it('ramps linearly between zoom 14 and 20', () => {
    expect(getPitchForZoom(17)).toBeCloseTo(25, 5);
    expect(getPitchForZoom(18.5)).toBeCloseTo(37.5, 5);
  });

  it('caps at the default max pitch from zoom 20 onward', () => {
    expect(getPitchForZoom(AUTO_PITCH_END_ZOOM)).toBe(50);
    expect(getPitchForZoom(AUTO_PITCH_END_ZOOM + 1.5)).toBe(50);
  });

  it('returns a flat pitch for invalid zoom values', () => {
    expect(getPitchForZoom(Number.NaN)).toBe(0);
    expect(getPitchForZoom(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
