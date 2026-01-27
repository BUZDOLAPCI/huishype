import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { View, type LayoutChangeEvent, type ScrollView } from 'react-native';
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

import type { Property } from '../../hooks/useProperties';
import type { PropertyDetailsData } from './types';
import { PropertyHeader } from './PropertyHeader';
import { PriceSection } from './PriceSection';
import { QuickActions } from './QuickActions';
import { PriceGuessSection } from './PriceGuessSection';
import { CommentsSection } from './CommentsSection';
import { PropertyDetails } from './PropertyDetails';
import { ListingLinks } from './ListingLinks';
import { LoadingSkeleton } from './LoadingSkeleton';

export interface PropertyBottomSheetProps {
  property: Property | null;
  isLoading?: boolean;
  onClose?: () => void;
  onSheetChange?: (index: number) => void;
  onSave?: (propertyId: string) => void;
  onShare?: (propertyId: string) => void;
  onFavorite?: (propertyId: string) => void;
  onGuessPress?: (propertyId: string) => void;
  onCommentPress?: (propertyId: string) => void;
  onAuthRequired?: () => void;
}

export interface PropertyBottomSheetRef {
  expand: () => void;
  collapse: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
  scrollToComments: () => void;
  scrollToGuess: () => void;
  getCurrentIndex: () => number;
}

// Convert basic Property to PropertyDetailsData with default values
function toPropertyDetails(property: Property): PropertyDetailsData {
  return {
    ...property,
    activityLevel: 'cold',
    commentCount: 0,
    guessCount: 0,
    viewCount: 0,
    isSaved: false,
    isFavorite: false,
  };
}

export const PropertyBottomSheet = forwardRef<PropertyBottomSheetRef, PropertyBottomSheetProps>(
  function PropertyBottomSheet(
    {
      property,
      isLoading = false,
      onClose,
      onSheetChange,
      onSave,
      onShare,
      onFavorite,
      onGuessPress,
      onCommentPress,
      onAuthRequired,
    },
    ref
  ) {
    const bottomSheetRef = useRef<BottomSheetLib>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const animatedIndex = useSharedValue(-1);

    // Section layout positions
    const sectionPositions = useRef<{ guess: number; comments: number }>({
      guess: 0,
      comments: 0,
    });

    // Snap points: 10% (peek), 50% (partial) and 90% (full)
    // Index 0 = peek (just drag handle visible)
    // Index 1 = partial (50% height)
    // Index 2 = full (90% height)
    const snapPoints = useMemo(() => ['10%', '50%', '90%'], []);

    // Handle section layout measurement
    const handleGuessSectionLayout = useCallback((event: LayoutChangeEvent) => {
      sectionPositions.current.guess = event.nativeEvent.layout.y;
    }, []);

    const handleCommentsSectionLayout = useCallback((event: LayoutChangeEvent) => {
      sectionPositions.current.comments = event.nativeEvent.layout.y;
    }, []);

    // Scroll to section helpers
    const scrollToSection = useCallback((sectionY: number) => {
      // Expand to full height first (index 2 = 90%), then scroll
      bottomSheetRef.current?.snapToIndex(2);
      // Small delay to let the expansion animation start
      setTimeout(() => {
        scrollViewRef.current?.scrollTo?.({ y: sectionY, animated: true });
      }, 300);
    }, []);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      expand: () => bottomSheetRef.current?.expand(),
      collapse: () => bottomSheetRef.current?.collapse(),
      close: () => bottomSheetRef.current?.close(),
      snapToIndex: (index: number) => bottomSheetRef.current?.snapToIndex(index),
      scrollToComments: () => scrollToSection(sectionPositions.current.comments),
      scrollToGuess: () => scrollToSection(sectionPositions.current.guess),
      getCurrentIndex: () => animatedIndex.value,
    }));

    // Render backdrop
    // Backdrop should only appear when sheet is expanded (index 1 or 2), not at peek (index 0)
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={0}
          appearsOnIndex={1}
          opacity={0.3}
          pressBehavior="close"
        />
      ),
      []
    );

    // Handle sheet changes
    const handleSheetChange = useCallback(
      (index: number) => {
        animatedIndex.value = index;
        // Notify parent of index change for preview card persistence logic
        onSheetChange?.(index);
        if (index === -1) {
          onClose?.();
        }
      },
      [animatedIndex, onClose, onSheetChange]
    );

    // Animated content opacity based on expand state
    // Index: -1 = closed, 0 = peek, 1 = partial, 2 = full
    // Content fades in as sheet expands from peek to partial
    const contentAnimatedStyle = useAnimatedStyle(() => {
      const opacity = interpolate(
        animatedIndex.value,
        [-1, 0, 1, 2],
        [0, 0.3, 1, 1],
        Extrapolation.CLAMP
      );
      return { opacity };
    });

    // Convert property to detailed format
    const propertyDetails = property ? toPropertyDetails(property) : null;

    // Determine initial index based on whether we have a property
    const initialIndex = property ? 0 : -1;

    return (
      <BottomSheetLib
        ref={bottomSheetRef}
        index={initialIndex}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        onChange={handleSheetChange}
        backgroundStyle={{ backgroundColor: 'white' }}
        handleIndicatorStyle={{ backgroundColor: '#D1D5DB', width: 40 }}
        style={{ zIndex: 1000 }}
      >
        <BottomSheetScrollView
          ref={scrollViewRef as any}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={contentAnimatedStyle}>
            {isLoading ? (
              <LoadingSkeleton />
            ) : propertyDetails ? (
              <View>
                {/* Property Header with Photos */}
                <PropertyHeader property={propertyDetails} />

                {/* Price Section */}
                <PriceSection property={propertyDetails} />

                {/* Quick Actions Bar */}
                <QuickActions
                  property={propertyDetails}
                  onSave={() => onSave?.(propertyDetails.id)}
                  onShare={() => onShare?.(propertyDetails.id)}
                  onFavorite={() => onFavorite?.(propertyDetails.id)}
                />

                {/* Listing Links (if available) */}
                <ListingLinks property={propertyDetails} />

                {/* Price Guess Section */}
                <View onLayout={handleGuessSectionLayout}>
                  <PriceGuessSection
                    property={propertyDetails}
                    onGuessPress={() => onGuessPress?.(propertyDetails.id)}
                  />
                </View>

                {/* Comments Section */}
                <View onLayout={handleCommentsSectionLayout}>
                  <CommentsSection
                    property={propertyDetails}
                    onAddComment={() => onCommentPress?.(propertyDetails.id)}
                    onAuthRequired={onAuthRequired}
                  />
                </View>

                {/* Property Details */}
                <PropertyDetails property={propertyDetails} />
              </View>
            ) : null}
          </Animated.View>
        </BottomSheetScrollView>
      </BottomSheetLib>
    );
  }
);
