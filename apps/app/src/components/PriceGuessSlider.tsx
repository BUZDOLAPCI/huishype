import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  interpolate,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

export interface PriceGuessSliderProps {
  propertyId: string;
  wozValue?: number;
  askingPrice?: number;
  currentFMV?: number;
  userGuess?: number;
  onGuessChange?: (price: number) => void;
  onGuessSubmit: (price: number) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  testID?: string;
}

// Price range constants
const MIN_PRICE = 50000;
const MAX_PRICE = 2000000;

// Logarithmic scale helpers
// Using log scale: most houses are in the 150k-600k range, so we want more precision there
function priceToPosition(price: number): number {
  const minLog = Math.log(MIN_PRICE);
  const maxLog = Math.log(MAX_PRICE);
  const priceLog = Math.log(Math.max(MIN_PRICE, Math.min(MAX_PRICE, price)));
  return (priceLog - minLog) / (maxLog - minLog);
}

function positionToPrice(position: number): number {
  const minLog = Math.log(MIN_PRICE);
  const maxLog = Math.log(MAX_PRICE);
  const clampedPosition = Math.max(0, Math.min(1, position));
  const priceLog = minLog + clampedPosition * (maxLog - minLog);
  // Round to nearest 1000 for cleaner values
  return Math.round(Math.exp(priceLog) / 1000) * 1000;
}

// Format price in Dutch locale
function formatPrice(price: number): string {
  return `\u20AC${price.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`;
}

// Check if two positions are "near" each other (within 3%)
function isNear(pos1: number, pos2: number, threshold = 0.03): boolean {
  return Math.abs(pos1 - pos2) <= threshold;
}

// Throttle function for haptic feedback
function throttle<T extends (...args: unknown[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastRun >= limit) {
      lastRun = now;
      func(...args);
    }
  };
}

// Reference marker component
function ReferenceMarker({
  position,
  label,
  color,
  isActive,
}: {
  position: number;
  label: string;
  color: string;
  isActive?: boolean;
}) {
  const opacity = useSharedValue(0.7);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isActive) {
      opacity.value = withSequence(
        withTiming(1, { duration: 150 }),
        withTiming(0.7, { duration: 150 })
      );
      scale.value = withSequence(
        withSpring(1.3, { damping: 8 }),
        withSpring(1, { damping: 12 })
      );
    }
  }, [isActive, opacity, scale]);

  const markerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      className="absolute -top-8 items-center"
      style={[
        { left: `${position * 100}%`, transform: [{ translateX: -20 }] },
        markerStyle,
      ]}
    >
      <Text className={`text-xs font-medium ${color}`}>{label}</Text>
      <View className={`w-0.5 h-3 ${color.replace('text-', 'bg-')}`} />
    </Animated.View>
  );
}

export function PriceGuessSlider({
  propertyId,
  wozValue,
  askingPrice,
  currentFMV,
  userGuess,
  onGuessChange,
  onGuessSubmit,
  disabled = false,
  isSubmitting = false,
  testID = 'price-guess-slider',
}: PriceGuessSliderProps) {
  // Initial price - prefer user's existing guess, then WOZ, then middle of range
  const initialPrice = userGuess ?? wozValue ?? 350000;
  const [guessedPrice, setGuessedPrice] = useState(initialPrice);
  const [isNearWOZ, setIsNearWOZ] = useState(false);

  // Animation values - use shared value for slider width for proper animated style updates
  const sliderWidthShared = useSharedValue(300);
  const [sliderWidth, setSliderWidth] = useState(300);
  const thumbPosition = useSharedValue(priceToPosition(initialPrice));
  const thumbScale = useSharedValue(1);
  const thumbPulse = useSharedValue(1);
  const priceDisplayScale = useSharedValue(1);
  const submitButtonScale = useSharedValue(1);
  const isDragging = useSharedValue(false);

  // Refs
  const lastHapticPrice = useRef(initialPrice);
  const lastWOZCrossing = useRef<number | null>(null);

  // Throttled haptic feedback
  const triggerSelectionHaptic = useCallback(
    throttle(() => {
      if (Platform.OS !== 'web') {
        Haptics.selectionAsync();
      }
    }, 50),
    []
  );

  // WOZ crossing haptic
  const triggerWOZHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  // Success haptic
  const triggerSuccessHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  // Update price and trigger callbacks
  const updatePrice = useCallback(
    (position: number) => {
      const newPrice = positionToPrice(position);

      // Check if we crossed the WOZ value
      if (wozValue) {
        const wozPosition = priceToPosition(wozValue);
        const wasAboveWOZ = priceToPosition(guessedPrice) > wozPosition;
        const isAboveWOZ = position > wozPosition;

        if (wasAboveWOZ !== isAboveWOZ && lastWOZCrossing.current !== newPrice) {
          lastWOZCrossing.current = newPrice;
          triggerWOZHaptic();
        }

        // Check if near WOZ for pulse effect
        const nearWOZ = isNear(position, wozPosition);
        if (nearWOZ !== isNearWOZ) {
          setIsNearWOZ(nearWOZ);
          if (nearWOZ) {
            thumbPulse.value = withSequence(
              withSpring(1.15, { damping: 6 }),
              withSpring(1, { damping: 10 })
            );
          }
        }
      }

      // Trigger haptic for significant price changes
      if (Math.abs(newPrice - lastHapticPrice.current) >= 10000) {
        lastHapticPrice.current = newPrice;
        triggerSelectionHaptic();
      }

      setGuessedPrice(newPrice);
      onGuessChange?.(newPrice);

      // Animate price display
      priceDisplayScale.value = withSequence(
        withSpring(1.05, { damping: 10 }),
        withSpring(1, { damping: 12 })
      );
    },
    [
      guessedPrice,
      wozValue,
      isNearWOZ,
      onGuessChange,
      thumbPulse,
      priceDisplayScale,
      triggerSelectionHaptic,
      triggerWOZHaptic,
    ]
  );

  // Handle slider layout to get width
  const handleSliderLayout = (event: LayoutChangeEvent) => {
    const newWidth = event.nativeEvent.layout.width;
    setSliderWidth(newWidth);
    sliderWidthShared.value = newWidth;
  };

  // Pan gesture for dragging the thumb
  const panGesture = Gesture.Pan()
    .enabled(!disabled)
    .onBegin(() => {
      isDragging.value = true;
      thumbScale.value = withSpring(1.3, { damping: 10 });
    })
    .onUpdate((event) => {
      const newPosition = Math.max(0, Math.min(1, event.x / sliderWidth));
      thumbPosition.value = newPosition;
      runOnJS(updatePrice)(newPosition);
    })
    .onEnd(() => {
      isDragging.value = false;
      thumbScale.value = withSpring(1, { damping: 12 });
    });

  // Tap gesture for track
  const tapGesture = Gesture.Tap()
    .enabled(!disabled)
    .onEnd((event) => {
      const newPosition = Math.max(0, Math.min(1, event.x / sliderWidth));
      thumbPosition.value = withSpring(newPosition, { damping: 15 });
      runOnJS(updatePrice)(newPosition);
      runOnJS(triggerSelectionHaptic)();
    });

  // Combined gestures
  const composedGestures = Gesture.Simultaneous(panGesture, tapGesture);

  // Thumb animated styles - use pixel positioning for web compatibility
  const thumbAnimatedStyle = useAnimatedStyle(() => {
    const leftPx = thumbPosition.value * sliderWidthShared.value;
    return {
      left: leftPx,
      transform: [
        { translateX: -16 },
        { scale: thumbScale.value * thumbPulse.value },
      ],
    };
  });

  // Track fill animated style - use pixel width for web compatibility
  const fillAnimatedStyle = useAnimatedStyle(() => {
    const widthPx = thumbPosition.value * sliderWidthShared.value;
    return {
      width: widthPx,
    };
  });

  // Price display animated style
  const priceAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: priceDisplayScale.value }],
  }));

  // Submit button animated style
  const submitAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: submitButtonScale.value }],
  }));

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (disabled || isSubmitting) return;

    submitButtonScale.value = withSequence(
      withTiming(0.95, { duration: 100 }),
      withSpring(1, { damping: 10 })
    );

    triggerSuccessHaptic();
    onGuessSubmit(guessedPrice);
  }, [disabled, isSubmitting, guessedPrice, onGuessSubmit, submitButtonScale, triggerSuccessHaptic]);

  // Quick adjustment handler
  const handleQuickAdjust = useCallback(
    (delta: number) => {
      if (disabled) return;

      const newPrice = Math.max(MIN_PRICE, Math.min(MAX_PRICE, guessedPrice + delta));
      const newPosition = priceToPosition(newPrice);

      thumbPosition.value = withSpring(newPosition, { damping: 15 });
      updatePrice(newPosition);
      triggerSelectionHaptic();
    },
    [disabled, guessedPrice, thumbPosition, updatePrice, triggerSelectionHaptic]
  );

  // Sync with external userGuess changes
  useEffect(() => {
    if (userGuess !== undefined && userGuess !== guessedPrice) {
      setGuessedPrice(userGuess);
      thumbPosition.value = withSpring(priceToPosition(userGuess), { damping: 15 });
    }
  }, [userGuess, guessedPrice, thumbPosition]);

  // Calculate reference marker positions
  const wozPosition = wozValue ? priceToPosition(wozValue) : null;
  const askingPosition = askingPrice ? priceToPosition(askingPrice) : null;
  const fmvPosition = currentFMV ? priceToPosition(currentFMV) : null;

  return (
    <GestureHandlerRootView>
      <View className="p-4 bg-white rounded-xl" testID={testID}>
        {/* Header */}
        <Text className="text-lg font-semibold text-gray-900 mb-1">
          What do you think this property is worth?
        </Text>

        {/* Reference values */}
        {wozValue && (
          <Text className="text-sm text-gray-500 mb-4">
            WOZ Value: {formatPrice(wozValue)}
          </Text>
        )}

        {/* Price Display */}
        <Animated.View style={priceAnimatedStyle} className="items-center mb-6">
          <Text
            className={`text-4xl font-bold ${disabled ? 'text-gray-400' : 'text-primary-600'}`}
            testID="price-display"
          >
            {formatPrice(guessedPrice)}
          </Text>
        </Animated.View>

        {/* Slider */}
        <View className="mb-8 pt-8 relative" onLayout={handleSliderLayout}>
          {/* Reference markers */}
          {wozPosition !== null && (
            <ReferenceMarker
              position={wozPosition}
              label="WOZ"
              color="text-purple-600"
              isActive={isNearWOZ}
            />
          )}
          {askingPosition !== null && (
            <ReferenceMarker
              position={askingPosition}
              label="Ask"
              color="text-orange-500"
            />
          )}
          {fmvPosition !== null && (
            <ReferenceMarker
              position={fmvPosition}
              label="FMV"
              color="text-blue-500"
            />
          )}

          {/* Slider track container - overflow visible for thumb */}
          <GestureDetector gesture={composedGestures}>
            <View
              className="rounded-full"
              style={{
                overflow: 'visible',
                position: 'relative',
                height: 12,
                backgroundColor: '#E5E7EB', // gray-200
              }}
            >
              {/* Fill */}
              <Animated.View
                className="rounded-full"
                style={[
                  fillAnimatedStyle,
                  {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    height: 12,
                    backgroundColor: disabled ? '#D1D5DB' : '#3B82F6', // gray-300 or primary-500
                  }
                ]}
              />

              {/* Thumb */}
              <Animated.View
                className="rounded-full shadow-lg"
                style={[
                  thumbAnimatedStyle,
                  {
                    position: 'absolute',
                    top: -10,
                    width: 32,
                    height: 32,
                    zIndex: 10,
                    backgroundColor: disabled
                      ? '#9CA3AF'  // gray-400
                      : isNearWOZ
                        ? '#8B5CF6' // purple-500
                        : '#2563EB', // primary-600
                  },
                ]}
                testID="slider-thumb"
              >
                <View className="flex-1 items-center justify-center">
                  <View className="w-1 h-3 bg-white/50 rounded-full" />
                </View>
              </Animated.View>
            </View>
          </GestureDetector>

          {/* Min/Max labels */}
          <View className="flex-row justify-between mt-2">
            <Text className="text-xs text-gray-400">{formatPrice(MIN_PRICE)}</Text>
            <Text className="text-xs text-gray-400">{formatPrice(MAX_PRICE)}</Text>
          </View>
        </View>

        {/* Quick adjustment buttons */}
        <View className="flex-row justify-center gap-2 mb-4">
          {[-50000, -10000, 10000, 50000].map((delta) => (
            <Pressable
              key={delta}
              onPress={() => handleQuickAdjust(delta)}
              disabled={disabled}
              className={`px-3 py-2 rounded-lg ${
                disabled ? 'bg-gray-100' : 'bg-gray-100 active:bg-gray-200'
              }`}
              testID={`adjust-${delta > 0 ? 'plus' : 'minus'}-${Math.abs(delta / 1000)}k`}
            >
              <Text
                className={`text-sm font-medium ${disabled ? 'text-gray-300' : 'text-gray-700'}`}
              >
                {delta > 0 ? '+' : ''}
                {(delta / 1000).toFixed(0)}k
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Submit button */}
        <Pressable
          onPress={handleSubmit}
          disabled={disabled || isSubmitting}
          testID="submit-guess-button"
        >
          <Animated.View
            className={`rounded-xl items-center flex-row justify-center ${
              disabled || isSubmitting
                ? 'bg-gray-200'
                : 'bg-primary-600 active:bg-primary-700'
            }`}
            style={[
              submitAnimatedStyle,
              {
                paddingVertical: 14,
                backgroundColor: disabled || isSubmitting ? '#E5E7EB' : '#2563EB',
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
              },
            ]}
          >
            {isSubmitting ? (
              <View className="flex-row items-center" style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="hourglass-outline" size={20} color="#9CA3AF" />
                <Text className="text-gray-500 font-semibold text-base ml-2" style={{ color: '#6B7280', fontWeight: '600', fontSize: 16, marginLeft: 8 }}>
                  Submitting...
                </Text>
              </View>
            ) : (
              <Text
                className={`font-semibold text-base ${
                  disabled ? 'text-gray-400' : 'text-white'
                }`}
                style={{
                  color: disabled ? '#9CA3AF' : '#FFFFFF',
                  fontWeight: '600',
                  fontSize: 16,
                }}
              >
                Submit Guess
              </Text>
            )}
          </Animated.View>
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
}
