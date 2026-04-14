/**
 * PropertyBottomSheet (web) — Responsive property details panel.
 *
 * Landscape: CSS side panel (slides from right, 420px wide)
 * Portrait: Bottom sheet (slides up from bottom, full width, drag handle)
 *
 * Portrait state model matches native @gorhom/bottom-sheet:
 *   closed (-1) → peek (0) → partial (1) → full (2)
 *   enablePanDownToClose=false: drag down from peek stays at peek
 *
 * Content rendering is delegated to PropertyContent — this file is
 * container-only (layout, gestures, state machine, CSS injection).
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from 'react';
import { ScrollView, Text } from 'react-native';
import { Icon } from '../ui/Icon';

import type { PropertyBottomSheetProps, PropertyBottomSheetRef } from './types';
import { PropertyContent } from './PropertyContent';
import {
  getPanelScrollDelay,
  getPreviewOpenTargetIndex,
  getSectionScrollTarget,
} from './sectionScroll';
import { useIsLandscape } from '../../hooks/useIsLandscape';

type SheetState = 'closed' | 'peek' | 'partial' | 'full';

/** Portrait snap points as translateY percentages */
const SNAP_POINTS: Record<Exclude<SheetState, 'closed'>, number> = {
  peek: 97,     // 3% visible — just the drag handle
  partial: 51.5, // 48.5% visible
  full: 0,       // 100% visible
};

function getSnapPercent(state: SheetState): number {
  return state === 'closed' ? 100 : SNAP_POINTS[state];
}

function getAllowedSnapStates(minState: SheetState): SheetState[] {
  return minState === 'peek'
    ? ['peek', 'partial', 'full']
    : ['closed', 'partial', 'full'];
}

function getAdjacentSnapState(
  state: SheetState,
  direction: 'up' | 'down',
  minState: SheetState,
): SheetState {
  const allowedStates = getAllowedSnapStates(minState);
  const currentIndex = allowedStates.indexOf(state);

  if (currentIndex === -1) {
    return state;
  }

  if (direction === 'up') {
    return allowedStates[Math.min(currentIndex + 1, allowedStates.length - 1)];
  }

  return allowedStates[Math.max(currentIndex - 1, 0)];
}

function clampDraggedPercent(percent: number, minState: SheetState): number {
  return Math.max(
    getSnapPercent('full'),
    Math.min(getSnapPercent(minState), percent),
  );
}

const DIRECTIONAL_SNAP_THRESHOLD_PERCENT = 10;

export function getNearestSnapState(
  percent: number,
  minState: SheetState,
): SheetState {
  const clampedPercent = clampDraggedPercent(percent, minState);
  const allowedStates = getAllowedSnapStates(minState);

  return allowedStates.reduce((closestState, candidateState) => {
    const closestDistance = Math.abs(
      clampedPercent - getSnapPercent(closestState),
    );
    const candidateDistance = Math.abs(
      clampedPercent - getSnapPercent(candidateState),
    );

    return candidateDistance < closestDistance ? candidateState : closestState;
  });
}

export function getDirectionalSnapState(
  fromState: SheetState,
  draggedPercent: number,
  minState: SheetState,
  directionalThresholdPercent = DIRECTIONAL_SNAP_THRESHOLD_PERCENT,
): SheetState {
  const nearestState = getNearestSnapState(draggedPercent, minState);
  const fromPercent = getSnapPercent(fromState);
  const movementDelta = draggedPercent - fromPercent;

  if (Math.abs(movementDelta) < directionalThresholdPercent) {
    return nearestState;
  }

  const direction: 'up' | 'down' = movementDelta < 0 ? 'up' : 'down';
  const adjacentState = getAdjacentSnapState(fromState, direction, minState);

  if (direction === 'up') {
    const nearestPercent = getSnapPercent(nearestState);
    const adjacentPercent = getSnapPercent(adjacentState);
    return nearestPercent <= adjacentPercent ? nearestState : adjacentState;
  }

  const nearestPercent = getSnapPercent(nearestState);
  const adjacentPercent = getSnapPercent(adjacentState);
  return nearestPercent >= adjacentPercent ? nearestState : adjacentState;
}

/** Map SheetState to index matching native @gorhom/bottom-sheet */
function stateToIndex(state: SheetState): number {
  switch (state) {
    case 'closed': return -1;
    case 'peek': return 0;
    case 'partial': return 1;
    case 'full': return 2;
  }
}

// CSS for both panel modes — injected once into <head>
const PANEL_CSS_ID = 'web-property-panel-css';
if (typeof document !== 'undefined') {
  let style = document.getElementById(PANEL_CSS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PANEL_CSS_ID;
    document.head.appendChild(style);
  }
  // Always update content — handles HMR where element exists but CSS is stale
  style.textContent = `
    .web-property-panel-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.15);
      z-index: 2000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .web-property-panel-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    /* ===== Landscape: side panel (slides from right) ===== */
    .web-property-panel--landscape {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      max-width: 100vw;
      background: white;
      z-index: 2001;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
    }
    .web-property-panel--landscape.open {
      transform: translateX(0);
    }
    @media (max-width: 640px) {
      .web-property-panel--landscape {
        width: 100vw;
      }
    }

    /* ===== Portrait: bottom sheet (slides up from bottom) ===== */
    /* bottom: 49px positions the sheet above the tab bar, matching native
       @gorhom/bottom-sheet which renders within the content area above the tab bar */
    .web-property-panel--portrait {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 49px;
      height: calc(92vh - 49px);
      background: white;
      z-index: 2001;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
    }
    .web-property-panel--portrait.peek {
      transform: translateY(97%);
    }
    .web-property-panel--portrait.partial {
      transform: translateY(51.5%);
    }
    .web-property-panel--portrait.full {
      transform: translateY(0);
    }

    /* Shared header */
    .web-property-panel-header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #FFF8F0;
      flex-shrink: 0;
    }
    .web-property-panel-close {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #FFF8F0;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .web-property-panel-close:hover {
      background: #F5F0E8;
    }

    /* Drag handle for portrait bottom sheet */
    .web-property-panel-handle {
      display: flex;
      justify-content: center;
      padding: 10px 0 2px;
      cursor: grab;
      flex-shrink: 0;
      touch-action: none;
    }
    .web-property-panel-handle:active {
      cursor: grabbing;
    }
    .web-property-panel-handle-bar {
      width: 40px;
      height: 4px;
      border-radius: 2px;
      background: #E8E0D4;
    }
  `;
}

/** Minimum distance (px) to register as a drag rather than a tap */
const TAP_THRESHOLD = 10;
export const PropertyBottomSheet = forwardRef<PropertyBottomSheetRef, PropertyBottomSheetProps>(
  function PropertyBottomSheet(
    {
      property,
      isLoading = false,
      isLiked: isLikedProp,
      isSaved: isSavedProp,
      isPreviewCardVisible,
      onClose,
      onSheetChange,
      onSave,
      onShare,
      onLike,
      onGuessPress,
      onCommentPress,
      onAuthRequired,
    },
    ref
  ) {
    const [sheetState, setSheetState] = useState<SheetState>('closed');
    const [hasMounted, setHasMounted] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelWidth, setPanelWidth] = useState<number | null>(null);
    const isLandscape = useIsLandscape();

    // Section position refs for scroll-to
    const guessSectionY = useRef(0);
    const commentsSectionY = useRef(0);

    const isOpen = sheetState !== 'closed';

    // Portrait backdrop: only at partial/full; landscape: when open
    const showBackdrop = !isLandscape
      ? (sheetState === 'partial' || sheetState === 'full')
      : isOpen;
    const backdropBlocksInteraction = showBackdrop && !isPreviewCardVisible;

    // Helper to update state and notify parent
    const updateState = useCallback((newState: SheetState) => {
      setSheetState(newState);
      onSheetChange?.(stateToIndex(newState));
    }, [onSheetChange]);

    // Portrait keeps the native-like peek handle visible while a preview card
    // is active. Landscape should keep the side panel fully closed until the
    // preview card is explicitly tapped.
    const minState: SheetState =
      !isLandscape && isPreviewCardVisible ? 'peek' : 'closed';
    const shouldRenderPanelContent = !isLandscape || sheetState !== 'closed';

    // Dismiss = go to minimum resting state (peek if preview card open, closed if not)
    const handleDismiss = useCallback(() => {
      updateState(minState);
      onClose?.();
    }, [updateState, minState, onClose]);

    // Portrait should keep the native-like peek state available while preview
    // is active. Landscape should stay closed until explicitly opened from the
    // preview card. Losing preview visibility still closes the panel.
    useEffect(() => {
      if (!hasMounted) {
        return;
      }

      if (isPreviewCardVisible) {
        if (!isLandscape && sheetState === 'closed') {
          updateState('peek');
        }
      } else if (sheetState !== 'closed') {
        updateState('closed');
      }
    }, [hasMounted, isLandscape, isPreviewCardVisible, sheetState, updateState]);

    useEffect(() => {
      setHasMounted(true);
    }, []);

    useEffect(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const updatePanelWidth = () => {
        const nextWidth = panel.getBoundingClientRect().width;
        setPanelWidth((currentWidth) =>
          currentWidth === nextWidth ? currentWidth : nextWidth,
        );
      };

      updatePanelWidth();

      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', updatePanelWidth);
        return () => window.removeEventListener('resize', updatePanelWidth);
      }

      const observer = new ResizeObserver(updatePanelWidth);
      observer.observe(panel);
      return () => observer.disconnect();
    }, [isLandscape, isOpen]);

    const scrollToSection = useCallback((sectionY: number) => {
      const targetY = getSectionScrollTarget(sectionY);
      const delay = getPanelScrollDelay(stateToIndex(sheetState), 2);

      updateState('full');

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: targetY, animated: true });
      }, delay);
    }, [sheetState, updateState]);

    const openFromPreview = useCallback(() => {
      const currentIndex = stateToIndex(sheetState);
      const targetIndex = isLandscape ? 2 : getPreviewOpenTargetIndex(currentIndex);
      const delay = getPanelScrollDelay(currentIndex, targetIndex);
      const nextState = targetIndex === 2 ? 'full' : 'partial';

      updateState(nextState);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }, delay);
    }, [isLandscape, sheetState, updateState]);

    // Expose ref methods matching native @gorhom/bottom-sheet behavior
    useImperativeHandle(ref, () => ({
      expand: () => updateState('full'),
      collapse: () => updateState(minState),
      close: () => {
        updateState(minState);
        onClose?.();
      },
      snapToIndex: (index: number) => {
        if (index < 0) {
          updateState(minState);
        } else if (index === 0) {
          updateState(isLandscape ? 'full' : 'peek');
        } else if (index === 1) {
          // Landscape side panel has no partial state — open fully
          updateState(isLandscape ? 'full' : 'partial');
        } else {
          updateState('full');
        }
      },
      openFromPreview,
      scrollToComments: () => scrollToSection(commentsSectionY.current),
      scrollToGuess: () => scrollToSection(guessSectionY.current),
      getCurrentIndex: () => stateToIndex(sheetState),
    }), [updateState, onClose, isLandscape, sheetState, minState, scrollToSection, openFromPreview]);

    // Dismiss on Escape key
    useEffect(() => {
      if (!isOpen) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') handleDismiss();
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [isOpen, handleDismiss]);

    // Backdrop click — dismiss (goes to peek or closed depending on preview card)
    const handleBackdropClick = useCallback(() => {
      handleDismiss();
    }, [handleDismiss]);

    // --- Drag gesture (handle + content area, portrait only) ---
    // Refs for drag state — avoids re-attaching DOM listeners on state changes
    const sheetStateRef = useRef(sheetState);
    sheetStateRef.current = sheetState;

    const scrollTopRef = useRef(0);

    const dragStartY = useRef<number | null>(null);
    const dragStartTime = useRef<number>(0);
    const dragStartState = useRef<SheetState>('closed');

    // --- Handle pointer events (always captures — handle is the primary drag target) ---
    const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
      dragStartY.current = e.clientY;
      dragStartTime.current = Date.now();
      dragStartState.current = sheetStateRef.current;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const panel = panelRef.current;
      if (panel) panel.style.transition = 'none';
    }, []);

    const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
      if (dragStartY.current === null) return;

      const panel = panelRef.current;
      if (!panel) return;

      const deltaY = e.clientY - dragStartY.current;
      const panelHeight = panel.offsetHeight;
      if (panelHeight === 0) return;

      const startPercent = getSnapPercent(dragStartState.current);
      const deltaPercent = (deltaY / panelHeight) * 100;
      const newPercent = clampDraggedPercent(
        startPercent + deltaPercent,
        minState,
      );

      panel.style.transform = `translateY(${newPercent}%)`;
    }, [minState]);

    /** Shared snap logic for both handle and content drags */
    const snapFromDrag = useCallback((deltaY: number, elapsed: number, fromState: SheetState, isTap: boolean) => {
      const panel = panelRef.current;
      if (panel) {
        panel.style.transition = '';
        panel.style.transform = '';
      }

      if (isTap) {
        if (fromState === 'peek') updateState('partial');
        else if (fromState === 'partial') updateState('full');
        else if (fromState === 'full') updateState('partial');
        return;
      }

      if (!panel || elapsed <= 0) {
        return;
      }

      const panelHeight = panel.offsetHeight;
      if (panelHeight === 0) {
        return;
      }

      const startPercent = getSnapPercent(fromState);
      const deltaPercent = (deltaY / panelHeight) * 100;
      const draggedPercent = clampDraggedPercent(
        startPercent + deltaPercent,
        minState,
      );

      updateState(
        getDirectionalSnapState(fromState, draggedPercent, minState),
      );
    }, [minState, updateState]);

    const onHandlePointerUp = useCallback((e: React.PointerEvent) => {
      if (dragStartY.current === null) return;
      const deltaY = e.clientY - dragStartY.current;
      const elapsed = Date.now() - dragStartTime.current;
      const fromState = dragStartState.current;
      dragStartY.current = null;
      snapFromDrag(deltaY, elapsed, fromState, Math.abs(deltaY) < TAP_THRESHOLD);
    }, [snapFromDrag]);

    // --- Content area touch events (drag-to-dismiss when scrolled to top) ---
    // Uses native DOM listeners so we can set { passive: false } for preventDefault
    const contentDragActive = useRef(false);

    useEffect(() => {
      if (isLandscape) return;
      const panel = panelRef.current;
      if (!panel) return;

      const onTouchStart = (e: TouchEvent) => {
        // Don't interfere with handle (it has its own pointer events)
        if ((e.target as HTMLElement).closest('[data-testid="web-panel-handle"]')) return;
        dragStartY.current = e.touches[0].clientY;
        dragStartTime.current = Date.now();
        dragStartState.current = sheetStateRef.current;
        contentDragActive.current = false;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (dragStartY.current === null) return;
        // If handle pointer events already claimed this gesture, skip
        if ((e.target as HTMLElement).closest('[data-testid="web-panel-handle"]')) return;

        const touchY = e.touches[0].clientY;
        const deltaY = touchY - dragStartY.current;

        if (!contentDragActive.current) {
          if (Math.abs(deltaY) < TAP_THRESHOLD) return; // Not enough movement yet

          const atScrollTop = scrollTopRef.current <= 1;
          const atFullState = dragStartState.current === 'full';
          const swipingDown = deltaY > 0;
          const swipingUp = deltaY < 0;

          // At scroll top: both up and down swipes drag the sheet
          // Exception: swiping up when already at full → let content scroll
          if (atScrollTop && (swipingDown || (swipingUp && !atFullState))) {
            contentDragActive.current = true;
            panel.style.transition = 'none';
          } else {
            // Has scroll offset or already full + swiping up → normal scroll
            dragStartY.current = null;
            return;
          }
        }

        e.preventDefault(); // Prevent scroll while dragging sheet

        const panelHeight = panel.offsetHeight;
        if (panelHeight === 0) return;
        const startPercent = getSnapPercent(dragStartState.current);
        const deltaPercent = (deltaY / panelHeight) * 100;
        const newPercent = clampDraggedPercent(
          startPercent + deltaPercent,
          minState,
        );
        panel.style.transform = `translateY(${newPercent}%)`;
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (!contentDragActive.current || dragStartY.current === null) {
          dragStartY.current = null;
          contentDragActive.current = false;
          return;
        }

        const touchY = e.changedTouches[0].clientY;
        const deltaY = touchY - dragStartY.current;
        const elapsed = Date.now() - dragStartTime.current;
        const fromState = dragStartState.current;
        dragStartY.current = null;
        contentDragActive.current = false;
        snapFromDrag(deltaY, elapsed, fromState, false);
      };

      panel.addEventListener('touchstart', onTouchStart, { passive: true });
      panel.addEventListener('touchmove', onTouchMove, { passive: false });
      panel.addEventListener('touchend', onTouchEnd, { passive: true });

      return () => {
        panel.removeEventListener('touchstart', onTouchStart);
        panel.removeEventListener('touchmove', onTouchMove);
        panel.removeEventListener('touchend', onTouchEnd);
      };
    }, [isLandscape, minState, snapFromDrag]);

    // Determine panel class based on orientation and state
    const panelClassName = isLandscape
      ? `web-property-panel--landscape ${isOpen ? 'open' : ''}`
      : `web-property-panel--portrait ${sheetState !== 'closed' ? sheetState : ''}`;

    return (
      <>
        {/* Backdrop */}
        <div
          className={`web-property-panel-backdrop ${showBackdrop ? 'open' : ''} ${backdropBlocksInteraction ? '' : 'preview-open'}`}
          onClick={handleBackdropClick}
          style={{ pointerEvents: backdropBlocksInteraction ? 'auto' : 'none' }}
          data-testid="web-panel-backdrop"
        />

        {/* Panel */}
        <div
          ref={panelRef}
          className={panelClassName}
          style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
          data-testid="web-property-panel"
        >
          {/* Drag handle (portrait bottom sheet only) */}
          {!isLandscape && (
            <div
              className="web-property-panel-handle"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              data-testid="web-panel-handle"
            >
              <div className="web-property-panel-handle-bar" />
            </div>
          )}

          {/* Header bar */}
          <div className="web-property-panel-header">
            <Text className="text-base font-semibold text-warm-900">
              Property Details
            </Text>
            <button
              className="web-property-panel-close"
              onClick={handleDismiss}
              data-testid="web-panel-close"
              aria-label="Close panel"
            >
              <Icon name="X" size="md" color="#9C958A" />
            </button>
          </div>

          {/* Scrollable content */}
          {shouldRenderPanelContent ? (
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1, width: '100%' }}
              showsVerticalScrollIndicator
              contentContainerStyle={{ paddingBottom: 40, width: '100%' }}
              onScroll={(e) => { scrollTopRef.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >
              <PropertyContent
                property={property}
                isLoading={isLoading}
                contentWidth={panelWidth ?? undefined}
                isLiked={isLikedProp}
                isSaved={isSavedProp}
                onSave={onSave}
                onShare={onShare}
                onLike={onLike}
                onScrollToComments={() => scrollToSection(commentsSectionY.current)}
                onScrollToGuess={() => scrollToSection(guessSectionY.current)}
                onGuessPress={onGuessPress}
                onCommentPress={onCommentPress}
                onAuthRequired={onAuthRequired}
                onGuessSectionLayout={(y) => { guessSectionY.current = y; }}
                onCommentsSectionLayout={(y) => { commentsSectionY.current = y; }}
                isVisible={sheetState !== 'closed'}
              />
            </ScrollView>
          ) : null}
        </div>
      </>
    );
  }
);
