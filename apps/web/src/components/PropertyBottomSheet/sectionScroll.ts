export const SECTION_SCROLL_DELAY_MS = 350;
export const SECTION_SCROLL_TOP_PADDING = 16;

export function getSectionScrollTarget(sectionY: number): number {
  return Math.max(0, sectionY - SECTION_SCROLL_TOP_PADDING);
}

export function getPanelScrollDelay(currentIndex: number, targetIndex: number): number {
  return currentIndex === targetIndex ? 0 : SECTION_SCROLL_DELAY_MS;
}

export function getPreviewOpenTargetIndex(currentIndex: number): number {
  return currentIndex === 2 ? 2 : 1;
}
