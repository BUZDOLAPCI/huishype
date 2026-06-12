import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useImperativeHandle,
  useState,
} from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BottomSheetLib, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
  type BottomSheetScrollViewMethods,
} from '@gorhom/bottom-sheet';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
  SlideInDown,
  SlideOutUp,
} from 'react-native-reanimated';

import type { PropertyBottomSheetProps, PropertyBottomSheetRef } from './types';
import { PropertyContent } from './PropertyContent';
import { CompactPropertyHeader } from './CompactPropertyHeader';
import {
  getPanelScrollDelay,
  getPreviewOpenTargetIndex,
  getSectionScrollTarget,
} from './sectionScroll';

export const PropertyBottomSheet = forwardRef<PropertyBottomSheetRef, PropertyBottomSheetProps>(
  function PropertyBottomSheet(
    {
      property,
      isLoading = false,
      isLiked,
      isSaved,
      isPreviewCardVisible,
      onSheetChange,
      onSave,
      onShare,
      onLike,
      onGuessPress,
      onCommentPress,
      onSocialSectionsMountChange,
      onAuthRequired,
    },
    ref
  ) {
    const bottomSheetRef = useRef<BottomSheetLib>(null);
    const scrollViewRef = useRef<BottomSheetScrollViewMethods | null>(null);
    const animatedIndex = useSharedValue(-1);
    const [scrollViewport, setScrollViewport] = useState({ offsetY: 0, height: 0 });
    const [summaryCardBottomY, setSummaryCardBottomY] = useState<number | null>(null);
    const [showCompactHeader, setShowCompactHeader] = useState(false);
    const scrollOffsetYRef = useRef(0);
    const compactHeaderVisibleRef = useRef(false);

    // Section layout positions for scroll-to
    const sectionPositions = useRef<{ guess: number; comments: number }>({
      guess: 0,
      comments: 0,
    });

    const snapPoints = useMemo(() => ['4%', '48.5%', '100%'], []);

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

    const handleGuessSectionLayout = useCallback((y: number) => {
      sectionPositions.current.guess = y;
    }, []);

    const handleCommentsSectionLayout = useCallback((y: number) => {
      sectionPositions.current.comments = y;
    }, []);

    const scrollToSection = useCallback((sectionY: number) => {
      const targetY = getSectionScrollTarget(sectionY);
      const delay = getPanelScrollDelay(animatedIndex.value, 2);

      bottomSheetRef.current?.snapToIndex(2);
      setTimeout(() => {
        scrollViewRef.current?.scrollTo?.({ y: targetY, animated: true });
      }, delay);
    }, [animatedIndex]);

    const openFromPreview = useCallback(() => {
      const targetIndex = getPreviewOpenTargetIndex(animatedIndex.value);
      const delay = getPanelScrollDelay(animatedIndex.value, targetIndex);

      bottomSheetRef.current?.snapToIndex(targetIndex);
      setTimeout(() => {
        scrollViewRef.current?.scrollTo?.({ y: 0, animated: false });
        scrollOffsetYRef.current = 0;
        updateCompactHeaderVisibility(0, summaryCardBottomY);
      }, delay);
    }, [animatedIndex, summaryCardBottomY, updateCompactHeaderVisibility]);

    useImperativeHandle(ref, () => ({
      expand: () => bottomSheetRef.current?.expand(),
      collapse: () => bottomSheetRef.current?.collapse(),
      close: () => bottomSheetRef.current?.snapToIndex(0),
      snapToIndex: (index: number) => bottomSheetRef.current?.snapToIndex(index),
      openFromPreview,
      scrollToComments: () => scrollToSection(sectionPositions.current.comments),
      scrollToGuess: () => scrollToSection(sectionPositions.current.guess),
      getCurrentIndex: () => animatedIndex.value,
    }), [animatedIndex, openFromPreview, scrollToSection]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => {
        if (isPreviewCardVisible) return null;
        return (
          <BottomSheetBackdrop
            {...props}
            disappearsOnIndex={0}
            appearsOnIndex={1}
            opacity={0.3}
            pressBehavior="close"
          />
        );
      },
      [isPreviewCardVisible]
    );

    const handleSheetChange = useCallback(
      (index: number) => {
        animatedIndex.value = index;
        onSheetChange?.(index);
      },
      [animatedIndex, onSheetChange]
    );

    const handleHalfExpandedBodyPress = useCallback(() => {
      if (animatedIndex.value !== 1) return;
      bottomSheetRef.current?.snapToIndex(2);
    }, [animatedIndex]);

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

    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextOffsetY = event.nativeEvent.contentOffset.y;
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

    const contentAnimatedStyle = useAnimatedStyle(() => {
      const opacity = interpolate(
        animatedIndex.value,
        [-1, 0, 1, 2],
        [0, 1, 1, 1],
        Extrapolation.CLAMP
      );
      return { opacity };
    });

    if (!isPreviewCardVisible) {
      return null;
    }

    return (
      <BottomSheetLib
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        onChange={handleSheetChange}
        backgroundStyle={{ backgroundColor: 'white' }}
        handleIndicatorStyle={{ backgroundColor: '#E8E0D4', width: 40 }}
        style={{ zIndex: 1000 }}
      >
        <View pointerEvents="none" style={styles.fixedContentBackground}>
          <LinearGradient
            colors={['#FFFFFF', '#FFFBF5']}
            style={styles.fixedTopFade}
          />
        </View>
        {showCompactHeader && property ? (
          <Animated.View
            entering={SlideInDown.duration(180)}
            exiting={SlideOutUp.duration(140)}
            style={styles.compactHeaderShell}
            testID="property-compact-header-shell"
          >
            <CompactPropertyHeader property={property} />
          </Animated.View>
        ) : null}
        <BottomSheetScrollView
          ref={scrollViewRef}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          onLayout={handleScrollViewLayout}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <Animated.View style={contentAnimatedStyle}>
            <PropertyContent
              property={property}
              isLoading={isLoading}
              contentBackgroundColor="transparent"
              isLiked={isLiked}
              isSaved={isSaved}
              onSave={onSave}
              onShare={onShare}
              onLike={onLike}
              onScrollToComments={() => scrollToSection(sectionPositions.current.comments)}
              onScrollToGuess={() => scrollToSection(sectionPositions.current.guess)}
              onGuessPress={onGuessPress}
              onViewAllComments={onCommentPress}
              onSocialSectionsMountChange={onSocialSectionsMountChange}
              onAuthRequired={onAuthRequired}
              onGuessSectionLayout={handleGuessSectionLayout}
              onCommentsSectionLayout={handleCommentsSectionLayout}
              onSummaryCardBottomLayout={handleSummaryCardBottomLayout}
              onHalfExpandedBodyPress={handleHalfExpandedBodyPress}
              scrollViewport={scrollViewport}
              deferSocialSectionsUntilActionsVisible
            />
          </Animated.View>
        </BottomSheetScrollView>
      </BottomSheetLib>
    );
  }
);

const styles = StyleSheet.create({
  compactHeaderShell: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    elevation: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#F5EBDD',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
  },
  fixedContentBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFBF5',
  },
  fixedTopFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 56,
  },
});
