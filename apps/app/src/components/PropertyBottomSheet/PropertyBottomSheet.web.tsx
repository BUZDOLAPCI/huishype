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
import {
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { PropertyBottomSheetProps, PropertyBottomSheetRef } from './types';
import { PropertyContent } from './PropertyContent';
import { CompactPropertyHeader } from './CompactPropertyHeader';
import {
  getPanelScrollDelay,
  getPreviewOpenTargetIndex,
  getSectionScrollTarget,
} from './sectionScroll';
import { useIsLandscape } from '../../hooks/useIsLandscape';
import {
  WebPanelChrome,
  type WebPanelState,
  webPanelStateToIndex,
} from '../ui/WebPanelChrome.web';

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
      onSocialSectionsMountChange,
      onAuthRequired,
      landscapeRightOffset,
    },
    ref
  ) {
    const [sheetState, setSheetState] = useState<WebPanelState>('closed');
    const [scrollViewport, setScrollViewport] = useState({ offsetY: 0, height: 0 });
    const [summaryCardBottomY, setSummaryCardBottomY] = useState<number | null>(null);
    const [showCompactHeader, setShowCompactHeader] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const scrollOffsetYRef = useRef(0);
    const compactHeaderVisibleRef = useRef(false);
    const isLandscape = useIsLandscape();

    // Section position refs for scroll-to
    const guessSectionY = useRef(0);
    const commentsSectionY = useRef(0);

    const isOpen = sheetState !== 'closed';

    // Portrait backdrop: only at partial/full; landscape: when open
    const showBackdrop = !isLandscape
      ? (sheetState === 'partial' || sheetState === 'full')
      : isOpen;

    // Helper to update state and notify parent
    const updateState = useCallback((newState: WebPanelState) => {
      setSheetState(newState);
      onSheetChange?.(webPanelStateToIndex(newState));
    }, [onSheetChange]);

    // The minimum resting state: peek when preview card is open, closed when not
    const minState: WebPanelState = (!isLandscape && isPreviewCardVisible) ? 'peek' : 'closed';

    const updateCompactHeaderVisibility = useCallback((offsetY: number, summaryBottomY: number | null) => {
      const shouldShow = summaryBottomY !== null && offsetY >= summaryBottomY;
      if (compactHeaderVisibleRef.current === shouldShow) {
        return;
      }

      compactHeaderVisibleRef.current = shouldShow;
      setShowCompactHeader(shouldShow);
    }, []);

    useEffect(() => {
      setSummaryCardBottomY(null);
      compactHeaderVisibleRef.current = false;
      setShowCompactHeader(false);
      scrollOffsetYRef.current = 0;
    }, [property?.id]);

    // Dismiss = go to minimum resting state (peek if preview card open, closed if not)
    const handleDismiss = useCallback(() => {
      updateState(minState);
      onClose?.();
    }, [updateState, minState, onClose]);

    // When preview card appears/disappears, auto-transition to appropriate state
    useEffect(() => {
      if (isLandscape) return;
      if (isPreviewCardVisible && sheetState === 'closed') {
        // Preview card just appeared — show the handle peek (matches native index={0})
        updateState('peek');
      } else if (!isPreviewCardVisible && sheetState !== 'closed') {
        // Preview card disappeared — fully close the sheet
        updateState('closed');
      }
    }, [isPreviewCardVisible, isLandscape]); // eslint-disable-line react-hooks/exhaustive-deps

    const scrollToSection = useCallback((sectionY: number) => {
      const targetY = getSectionScrollTarget(sectionY);
      const delay = getPanelScrollDelay(webPanelStateToIndex(sheetState), 2);

      updateState('full');

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: targetY, animated: true });
      }, delay);
    }, [sheetState, updateState]);

    const openFromPreview = useCallback(() => {
      const currentIndex = webPanelStateToIndex(sheetState);
      const targetIndex = isLandscape ? 2 : getPreviewOpenTargetIndex(currentIndex);
      const delay = getPanelScrollDelay(currentIndex, targetIndex);
      const nextState = targetIndex === 2 ? 'full' : 'partial';

      updateState(nextState);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        scrollOffsetYRef.current = 0;
        updateCompactHeaderVisibility(0, summaryCardBottomY);
      }, delay);
    }, [isLandscape, sheetState, summaryCardBottomY, updateCompactHeaderVisibility, updateState]);

    const handleHalfExpandedBodyPress = useCallback(() => {
      if (isLandscape || sheetState !== 'partial') return;
      updateState('full');
    }, [isLandscape, sheetState, updateState]);

    const handleScrollViewLayout = useCallback((event: LayoutChangeEvent) => {
      const nextHeight = event.nativeEvent.layout.height;
      setScrollViewport((current) => {
        if (Math.abs(current.height - nextHeight) < 1) {
          return current;
        }

        return {
          ...current,
          height: nextHeight,
        };
      });
    }, []);

    const handleScroll = useCallback((
      event: NativeSyntheticEvent<NativeScrollEvent>,
      scrollTopRef: { current: number },
    ) => {
      const nextOffsetY = event.nativeEvent.contentOffset.y;
      scrollTopRef.current = nextOffsetY;
      scrollOffsetYRef.current = nextOffsetY;
      updateCompactHeaderVisibility(nextOffsetY, summaryCardBottomY);
      setScrollViewport((current) => {
        if (Math.abs(current.offsetY - nextOffsetY) < 48) {
          return current;
        }

        return {
          ...current,
          offsetY: nextOffsetY,
        };
      });
    }, [summaryCardBottomY, updateCompactHeaderVisibility]);

    const handleSummaryCardBottomLayout = useCallback((bottomY: number) => {
      setSummaryCardBottomY(bottomY);
      updateCompactHeaderVisibility(scrollOffsetYRef.current, bottomY);
    }, [updateCompactHeaderVisibility]);

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
      getCurrentIndex: () => webPanelStateToIndex(sheetState),
    }), [updateState, onClose, isLandscape, sheetState, minState, scrollToSection, openFromPreview]);

    return (
      <WebPanelChrome
        state={sheetState}
        titleNode={
          showCompactHeader && property ? <CompactPropertyHeader property={property} /> : null
        }
        showHeader={showCompactHeader}
        headerOverlay
        onStateChange={updateState}
        onClose={handleDismiss}
        showBackdrop={showBackdrop}
        landscapeRightOffset={landscapeRightOffset}
        enableContentDrag
        enableBodyPressExpand
      >
        {({ contentWidth, scrollTopRef }) => (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1, width: '100%' }}
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingBottom: 40, width: '100%' }}
            onLayout={handleScrollViewLayout}
            onScroll={(e) => handleScroll(e, scrollTopRef)}
            scrollEventThrottle={16}
          >
            <PropertyContent
              property={property}
              isLoading={isLoading}
              contentWidth={contentWidth}
              isLiked={isLikedProp}
              isSaved={isSavedProp}
              onSave={onSave}
              onShare={onShare}
              onLike={onLike}
              onScrollToComments={() => scrollToSection(commentsSectionY.current)}
              onScrollToGuess={() => scrollToSection(guessSectionY.current)}
              onGuessPress={onGuessPress}
              onViewAllComments={onCommentPress}
              onSocialSectionsMountChange={onSocialSectionsMountChange}
              onAuthRequired={onAuthRequired}
              onGuessSectionLayout={(y) => { guessSectionY.current = y; }}
              onCommentsSectionLayout={(y) => { commentsSectionY.current = y; }}
              onSummaryCardBottomLayout={handleSummaryCardBottomLayout}
              onHalfExpandedBodyPress={handleHalfExpandedBodyPress}
              onHeaderClose={handleDismiss}
              isVisible={sheetState !== 'closed'}
              scrollViewport={scrollViewport}
              deferSocialSectionsUntilActionsVisible
            />
          </ScrollView>
        )}
      </WebPanelChrome>
    );
  }
);
