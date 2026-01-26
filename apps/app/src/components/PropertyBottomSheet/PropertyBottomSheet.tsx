import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
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
    const animatedIndex = useSharedValue(-1);

    // Snap points: 50% (partial) and 90% (full)
    const snapPoints = useMemo(() => ['50%', '90%'], []);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      expand: () => bottomSheetRef.current?.expand(),
      collapse: () => bottomSheetRef.current?.collapse(),
      close: () => bottomSheetRef.current?.close(),
      snapToIndex: (index: number) => bottomSheetRef.current?.snapToIndex(index),
    }));

    // Render backdrop
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
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
        if (index === -1) {
          onClose?.();
        }
      },
      [animatedIndex, onClose]
    );

    // Animated content opacity based on expand state
    const contentAnimatedStyle = useAnimatedStyle(() => {
      const opacity = interpolate(
        animatedIndex.value,
        [-1, 0, 1],
        [0, 1, 1],
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
                <PriceGuessSection
                  property={propertyDetails}
                  onGuessPress={() => onGuessPress?.(propertyDetails.id)}
                />

                {/* Comments Section */}
                <CommentsSection
                  property={propertyDetails}
                  onAddComment={() => onCommentPress?.(propertyDetails.id)}
                  onAuthRequired={onAuthRequired}
                />

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
