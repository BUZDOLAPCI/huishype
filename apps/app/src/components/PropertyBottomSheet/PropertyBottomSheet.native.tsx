import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

import { useProperty } from '../../hooks/useProperties';
import { useListings } from '../../hooks/useListings';
import { usePropertyView } from '../../hooks/usePropertyView';
import type { PropertyBottomSheetProps, PropertyBottomSheetRef } from './types';
import { toPropertyDetails } from './types';
import { PropertyHeader } from './PropertyHeader';
import { PriceSection } from './PriceSection';
import { QuickActions } from './QuickActions';
import { PriceGuessSection } from './PriceGuessSection';
import { CommentsSection } from './CommentsSection';
import { PropertyDetails } from './PropertyDetails';
import { ListingLinks } from './ListingLinks';
import { ListingSubmissionSheet } from './ListingSubmissionSheet';
import { LoadingSkeleton } from './LoadingSkeleton';

export const PropertyBottomSheet = forwardRef<PropertyBottomSheetRef, PropertyBottomSheetProps>(
  function PropertyBottomSheet(
    {
      property,
      isLoading = false,
      isLiked: isLikedProp,
      isSaved: isSavedProp,
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
    const bottomSheetRef = useRef<BottomSheetLib>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const animatedIndex = useSharedValue(-1);
    const queryClient = useQueryClient();

    // Listing submission modal state
    const [showSubmission, setShowSubmission] = useState(false);

    // Fetch enriched property details (viewCount, activityLevel, etc.)
    const { data: enrichedProperty } = useProperty(property?.id ?? null);

    // Record view when property is opened
    const { recordPropertyView } = usePropertyView();
    useEffect(() => {
      if (property?.id) {
        recordPropertyView(property.id);
      }
    }, [property?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch listings for the current property
    const { data: listings = [] } = useListings(property?.id ?? null);

    // Track whether sheet should be mounted (only when we have a property)
    // This prevents the handle indicator from being visible when no property is selected
    const [isSheetMounted, setIsSheetMounted] = useState(false);

    // Mount sheet when property is provided, unmount when closed
    useEffect(() => {
      if (property) {
        setIsSheetMounted(true);
      }
    }, [property]);

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
          // Unmount sheet when fully closed to prevent handle from being visible
          setIsSheetMounted(false);
          onClose?.();
        }
      },
      [animatedIndex, onClose, onSheetChange]
    );

    // Animated content opacity based on expand state
    // Index: -1 = closed, 0 = peek, 1 = partial, 2 = full
    // Content is fully visible at all open states
    const contentAnimatedStyle = useAnimatedStyle(() => {
      const opacity = interpolate(
        animatedIndex.value,
        [-1, 0, 1, 2],
        [0, 1, 1, 1],
        Extrapolation.CLAMP
      );
      return { opacity };
    });

    // Convert property to detailed format, merging enriched API data
    const propertyDetails = property
      ? toPropertyDetails(property, enrichedProperty as Record<string, unknown> | null | undefined, { isLiked: isLikedProp, isSaved: isSavedProp })
      : null;

    // Don't render the sheet at all if it's not mounted
    // This completely hides the handle indicator when no property is selected
    if (!isSheetMounted) {
      return null;
    }

    return (
      <>
      <BottomSheetLib
        ref={bottomSheetRef}
        index={0}
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
                  onLike={() => onLike?.(propertyDetails.id)}
                />

                {/* Listing Links (if available) */}
                <ListingLinks
                  listings={listings}
                  onAddListing={() => setShowSubmission(true)}
                />

                {/* Price Guess Section */}
                <View onLayout={handleGuessSectionLayout}>
                  <PriceGuessSection
                    property={propertyDetails}
                    onGuessPress={() => onGuessPress?.(propertyDetails.id)}
                    onLoginRequired={onAuthRequired}
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
      {property && (
        <ListingSubmissionSheet
          propertyId={property.id}
          visible={showSubmission}
          onClose={() => setShowSubmission(false)}
          onSubmitted={() => {
            setShowSubmission(false);
            queryClient.invalidateQueries({ queryKey: ['listings', property.id] });
          }}
          onAuthRequired={onAuthRequired}
        />
      )}
    </>
    );
  }
);
