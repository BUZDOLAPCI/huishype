import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { type ScrollView } from 'react-native';
import BottomSheetLib, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

import type { PropertyBottomSheetProps, PropertyBottomSheetRef } from './types';
import { PropertyContent } from './PropertyContent';
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
      onViewAllComments,
      onViewAllGuesses,
      onAuthRequired,
    },
    ref
  ) {
    const bottomSheetRef = useRef<BottomSheetLib>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const animatedIndex = useSharedValue(-1);

    // Section layout positions for scroll-to
    const sectionPositions = useRef<{ guess: number; comments: number }>({
      guess: 0,
      comments: 0,
    });

    const snapPoints = useMemo(() => ['4%', '48.5%', '100%'], []);

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
      }, delay);
    }, [animatedIndex]);

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
        <BottomSheetScrollView
          ref={scrollViewRef as any}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={contentAnimatedStyle}>
            <PropertyContent
              property={property}
              isLoading={isLoading}
              isLiked={isLiked}
              isSaved={isSaved}
              onSave={onSave}
              onShare={onShare}
              onLike={onLike}
              onScrollToComments={() => scrollToSection(sectionPositions.current.comments)}
              onScrollToGuess={() => scrollToSection(sectionPositions.current.guess)}
              onGuessPress={onGuessPress}
              onCommentPress={onCommentPress}
              onViewAllComments={onViewAllComments}
              onViewAllGuesses={onViewAllGuesses}
              onAuthRequired={onAuthRequired}
              onGuessSectionLayout={handleGuessSectionLayout}
              onCommentsSectionLayout={handleCommentsSectionLayout}
            />
          </Animated.View>
        </BottomSheetScrollView>
      </BottomSheetLib>
    );
  }
);
