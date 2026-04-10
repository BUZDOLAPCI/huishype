import {
  getPanelScrollDelay,
  getPreviewOpenTargetIndex,
  getSectionScrollTarget,
  SECTION_SCROLL_DELAY_MS,
  SECTION_SCROLL_TOP_PADDING,
} from '../sectionScroll';

describe('sectionScroll', () => {
  it('leaves a small inset between the panel top and the target section', () => {
    expect(getSectionScrollTarget(200)).toBe(200 - SECTION_SCROLL_TOP_PADDING);
  });

  it('clamps near-top sections to zero', () => {
    expect(getSectionScrollTarget(8)).toBe(0);
  });

  it('skips the scroll delay when the panel is already at the target index', () => {
    expect(getPanelScrollDelay(2, 2)).toBe(0);
  });

  it('keeps the shared scroll delay when the panel still needs to animate open', () => {
    expect(getPanelScrollDelay(0, 1)).toBe(SECTION_SCROLL_DELAY_MS);
  });

  it('opens preview taps into partial unless the sheet is already full', () => {
    expect(getPreviewOpenTargetIndex(0)).toBe(1);
    expect(getPreviewOpenTargetIndex(1)).toBe(1);
    expect(getPreviewOpenTargetIndex(2)).toBe(2);
  });
});
