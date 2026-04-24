import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, LayoutChangeEvent } from 'react-native';
import { Icon } from './ui/Icon';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';

export type PriceGuessSliderVariant = 'compact' | 'full' | 'embedded';
export type PriceGuessSliderStartSource =
  | 'user_guess'
  | 'active_listing_asking_price'
  | 'official_valuation_adjusted'
  | 'local_comparable_price_per_m2'
  | 'official_valuation'
  | 'country_default'
  | 'initial_price';
export type PriceGuessSliderStartConfidence =
  | 'submitted'
  | 'known'
  | 'usable'
  | 'weak'
  | 'fallback'
  | 'none';

type PriceGuessSliderAnalyticsEventName =
  | 'price_guess_slider_shown'
  | 'price_guess_slider_submitted';

interface PriceGuessSliderAnalyticsEvent {
  name: PriceGuessSliderAnalyticsEventName;
  properties: Record<string, unknown>;
  timestamp: string;
}

interface AnalyticsGlobal {
  __HUISHYPE_ANALYTICS_EVENTS__?: PriceGuessSliderAnalyticsEvent[];
  __HUISHYPE_ANALYTICS_LISTENER__?: (event: PriceGuessSliderAnalyticsEvent) => void;
}

export interface PriceGuessSliderProps {
  propertyId: string;
  countryCode?: string;
  officialValuation?: number;
  officialValuationYear?: number | null;
  askingPrice?: number;
  initialPrice?: number;
  initialPriceSource?: PriceGuessSliderStartSource;
  initialPriceConfidence?: PriceGuessSliderStartConfidence;
  initialPriceSampleSize?: number;
  currentFMV?: number;
  userGuess?: number;
  onGuessChange?: (price: number) => void;
  onGuessSubmit: (price: number) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  /** Display variant. Default 'full'. */
  variant?: PriceGuessSliderVariant;
  testID?: string;
}

// Price range constants
const FALLBACK_MIN_PRICE = 50000;
const ABSOLUTE_MIN_PRICE = 10000;
const RANGE_BELOW_OFFICIAL_VALUATION = 50000;
const RANGE_ABOVE_START_PRICE = 400000;
const MINIMUM_RANGE_WIDTH = 50000;
const DEFAULT_GUESS_START = 350000;
const PRICE_BUCKET_SIZE = 50000;

interface PriceGuessSliderRange {
  min: number;
  max: number;
}

function getCountryDefaultGuessStart(_countryCode?: string): number {
  return DEFAULT_GUESS_START;
}

function resolveSliderRange({
  officialValuation,
  startPrice,
}: {
  officialValuation?: number;
  startPrice: number;
}): PriceGuessSliderRange {
  const validOfficialValuation =
    typeof officialValuation === 'number' &&
    Number.isFinite(officialValuation) &&
    officialValuation > 0
      ? officialValuation
      : undefined;
  const min = validOfficialValuation
    ? Math.max(ABSOLUTE_MIN_PRICE, validOfficialValuation - RANGE_BELOW_OFFICIAL_VALUATION)
    : FALLBACK_MIN_PRICE;
  const requestedMax = startPrice + RANGE_ABOVE_START_PRICE;

  return {
    min,
    max: Math.max(requestedMax, min + MINIMUM_RANGE_WIDTH),
  };
}

function clampPriceToRange(price: number, range: PriceGuessSliderRange): number {
  return Math.max(range.min, Math.min(range.max, price));
}

// Logarithmic scale helpers
// Using log scale: most houses are in the 150k-600k range, so we want more precision there
function priceToPosition(price: number, range: PriceGuessSliderRange): number {
  const minLog = Math.log(range.min);
  const maxLog = Math.log(range.max);
  const priceLog = Math.log(clampPriceToRange(price, range));
  return (priceLog - minLog) / (maxLog - minLog);
}

function positionToPrice(position: number, range: PriceGuessSliderRange): number {
  const minLog = Math.log(range.min);
  const maxLog = Math.log(range.max);
  const clampedPosition = Math.max(0, Math.min(1, position));
  const priceLog = minLog + clampedPosition * (maxLog - minLog);
  // Round to nearest 1000 for cleaner values
  return Math.round(Math.exp(priceLog) / 1000) * 1000;
}

// Format price using country config
function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function formatValuationLabel(countryCode?: string, year?: number | null): string {
  const label = getValuationLabel(countryCode);
  return year ? `${label} (${year})` : label;
}

function formatCompactPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode, { compact: true })
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatBubblePrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode, { compact: true })
    .replace(/[\s\u00A0\u202F]+/g, '\u00A0')
    .trim();
}

function formatMarkerLabel(label: string, price: number, countryCode?: string): string {
  return `${label} ${formatCompactPrice(price, countryCode)}`;
}

function hasSamePrice(left?: number, right?: number): boolean {
  return left !== undefined && right !== undefined && left === right;
}

function bucketPrice(price: number): string {
  const lower = Math.floor(price / PRICE_BUCKET_SIZE) * PRICE_BUCKET_SIZE;
  const upper = lower + PRICE_BUCKET_SIZE - 1;
  return `${Math.round(lower / 1000)}k-${Math.round(upper / 1000)}k`;
}

function bucketDelta(delta: number): string {
  if (delta === 0) {
    return '0';
  }

  const sign = delta > 0 ? '+' : '-';
  const absoluteDelta = Math.abs(delta);
  const lower = Math.floor(absoluteDelta / PRICE_BUCKET_SIZE) * PRICE_BUCKET_SIZE;
  const upper = lower + PRICE_BUCKET_SIZE - 1;
  return `${sign}${Math.round(lower / 1000)}k-${Math.round(upper / 1000)}k`;
}

function emitPriceGuessSliderAnalyticsEvent(
  name: PriceGuessSliderAnalyticsEventName,
  properties: Record<string, unknown>,
): void {
  const event: PriceGuessSliderAnalyticsEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };
  const analyticsGlobal = globalThis as typeof globalThis &
    AnalyticsGlobal & {
      dispatchEvent?: (event: Event) => boolean;
      CustomEvent?: typeof CustomEvent;
    };

  analyticsGlobal.__HUISHYPE_ANALYTICS_LISTENER__?.(event);
  analyticsGlobal.__HUISHYPE_ANALYTICS_EVENTS__?.push(event);

  if (
    typeof analyticsGlobal.dispatchEvent === 'function' &&
    typeof analyticsGlobal.CustomEvent === 'function'
  ) {
    analyticsGlobal.dispatchEvent(
      new analyticsGlobal.CustomEvent('huishype:analytics', {
        detail: event,
      }),
    );
  }
}

function resolveStartSource({
  userGuess,
  initialPrice,
  initialPriceSource,
  officialValuation,
  askingPrice,
}: {
  userGuess?: number;
  initialPrice?: number;
  initialPriceSource?: PriceGuessSliderStartSource;
  officialValuation?: number;
  askingPrice?: number;
}): PriceGuessSliderStartSource {
  if (userGuess !== undefined) {
    return 'user_guess';
  }
  if (askingPrice !== undefined) {
    return 'active_listing_asking_price';
  }
  if (initialPrice !== undefined) {
    return initialPriceSource ?? 'initial_price';
  }
  if (officialValuation !== undefined) {
    return 'official_valuation';
  }
  return 'country_default';
}

function resolveStartConfidence({
  source,
  initialPriceConfidence,
}: {
  source: PriceGuessSliderStartSource;
  initialPriceConfidence?: PriceGuessSliderStartConfidence;
}): PriceGuessSliderStartConfidence {
  if (source === 'user_guess') {
    return 'submitted';
  }
  if (initialPriceConfidence) {
    return initialPriceConfidence;
  }
  if (source === 'active_listing_asking_price') {
    return 'known';
  }
  if (source === 'official_valuation') {
    return 'usable';
  }
  if (source === 'country_default') {
    return 'fallback';
  }
  return 'none';
}

function buildStartAnalytics({
  price,
  source,
  confidence,
  sampleSize,
}: {
  price: number;
  source: PriceGuessSliderStartSource;
  confidence: PriceGuessSliderStartConfidence;
  sampleSize?: number;
}) {
  return {
    price,
    source,
    confidence,
    sampleSize,
    startBucket: bucketPrice(price),
  };
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
  top,
  connectorHeight,
}: {
  position: number;
  label: string;
  color: string;
  isActive?: boolean;
  top: number;
  connectorHeight: number;
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
    transform: [{ translateX: -56 }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      className="absolute items-center"
      style={[
        { left: `${position * 100}%`, top, width: 112 },
        markerStyle,
      ]}
    >
      <View
        style={{
          width: 1,
          height: connectorHeight,
          backgroundColor: '#D9D4CC',
        }}
      />
      <Text className={`text-xs text-center ${color}`} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

function InlineReferenceLabel({
  position,
  label,
  color,
  connectorHeight,
}: {
  position: number | null;
  label: string;
  color: string;
  connectorHeight: number;
}) {
  if (position === null) {
    return null;
  }

  return (
    <View
      className="absolute items-center"
      style={{
        left: `${position * 100}%`,
        top: 0,
        width: 112,
        transform: [{ translateX: -56 }],
      }}
    >
      <View
        style={{
          width: 1,
          height: connectorHeight,
          backgroundColor: '#D9D4CC',
        }}
      />
      <Text
        className="font-display text-xs"
        numberOfLines={1}
        style={{
          color,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function TrackMarker({
  position,
  color,
  testID,
  top = -3,
}: {
  position: number | null;
  color: string;
  testID: string;
  top?: number;
}) {
  if (position === null) {
    return null;
  }

  return (
    <View
      className="absolute"
      style={{
        left: `${position * 100}%`,
        top,
        width: 2,
        height: 18,
        marginLeft: -1,
        borderRadius: 999,
        backgroundColor: color,
      }}
      testID={testID}
    />
  );
}

export function PriceGuessSlider({
  propertyId: _propertyId,
  countryCode,
  officialValuation,
  officialValuationYear,
  askingPrice,
  initialPrice,
  initialPriceSource,
  initialPriceConfidence,
  initialPriceSampleSize,
  currentFMV,
  userGuess,
  onGuessChange,
  onGuessSubmit,
  disabled = false,
  isSubmitting = false,
  variant = 'full',
  testID = 'price-guess-slider',
}: PriceGuessSliderProps) {
  const countryDefaultGuessStart = getCountryDefaultGuessStart(countryCode);
  const resolvedAskingPrice =
    typeof askingPrice === 'number' && Number.isFinite(askingPrice) && askingPrice > 0
      ? askingPrice
      : undefined;
  // Initial price - prefer user's existing guess, asking, API initializer, WOZ/valuation, then country default.
  const resolvedInitialPrice =
    userGuess ??
    resolvedAskingPrice ??
    initialPrice ??
    officialValuation ??
    countryDefaultGuessStart;
  const [sliderStartPrice, setSliderStartPrice] = useState(resolvedInitialPrice);
  const sliderRange = useMemo(
    () => resolveSliderRange({ officialValuation, startPrice: sliderStartPrice }),
    [officialValuation, sliderStartPrice],
  );
  const resolvedStartSource = resolveStartSource({
    userGuess,
    initialPrice,
    initialPriceSource,
    officialValuation,
    askingPrice: resolvedAskingPrice,
  });
  const resolvedStartConfidence = resolveStartConfidence({
    source: resolvedStartSource,
    initialPriceConfidence,
  });
  const [guessedPrice, setGuessedPrice] = useState(resolvedInitialPrice);
  const [isNearWOZ, setIsNearWOZ] = useState(false);

  // Animation values - use shared value for slider width for proper animated style updates
  const sliderWidthShared = useSharedValue(300);
  const [sliderWidth, setSliderWidth] = useState(300);
  const thumbPosition = useSharedValue(priceToPosition(resolvedInitialPrice, sliderRange));
  const thumbScale = useSharedValue(1);
  const thumbPulse = useSharedValue(1);
  const priceDisplayScale = useSharedValue(1);
  const submitButtonScale = useSharedValue(1);
  const isDragging = useSharedValue(false);

  // Refs
  const hasUserInteracted = useRef(false);
  const initialPriceSyncDone = useRef(
    initialPrice !== undefined || resolvedAskingPrice !== undefined
  );
  const hasLoggedShown = useRef(false);
  const startAnalytics = useRef(
    buildStartAnalytics({
      price: resolvedInitialPrice,
      source: resolvedStartSource,
      confidence: resolvedStartConfidence,
      sampleSize: initialPriceSampleSize,
    }),
  );
  const lastHapticPrice = useRef(resolvedInitialPrice);
  const lastWOZCrossing = useRef<number | null>(null);
  const lastSyncedUserGuess = useRef<number | undefined>(userGuess);

  useEffect(() => {
    if (hasLoggedShown.current) {
      return;
    }

    hasLoggedShown.current = true;
    emitPriceGuessSliderAnalyticsEvent('price_guess_slider_shown', {
      propertyId: _propertyId,
      countryCode,
      source: startAnalytics.current.source,
      confidence: startAnalytics.current.confidence,
      startBucket: startAnalytics.current.startBucket,
      sampleSize: startAnalytics.current.sampleSize,
    });
  }, [_propertyId, countryCode]);

  const markUserInteracted = useCallback(() => {
    hasUserInteracted.current = true;
  }, []);

  // Throttled haptic feedback
  const triggerSelectionHaptic = useMemo(
    () => throttle(() => {
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
      const newPrice = positionToPrice(position, sliderRange);

      // Check if we crossed the WOZ value
      if (officialValuation) {
        const wozPosition = priceToPosition(officialValuation, sliderRange);
        const wasAboveWOZ = priceToPosition(guessedPrice, sliderRange) > wozPosition;
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
      officialValuation,
      isNearWOZ,
      onGuessChange,
      sliderRange,
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
      runOnJS(markUserInteracted)();
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
      runOnJS(markUserInteracted)();
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
    emitPriceGuessSliderAnalyticsEvent('price_guess_slider_submitted', {
      propertyId: _propertyId,
      countryCode,
      source: startAnalytics.current.source,
      confidence: startAnalytics.current.confidence,
      startBucket: startAnalytics.current.startBucket,
      submittedBucket: bucketPrice(guessedPrice),
      deltaBucket: bucketDelta(guessedPrice - startAnalytics.current.price),
      sampleSize: startAnalytics.current.sampleSize,
    });
    onGuessSubmit(guessedPrice);
  }, [
    _propertyId,
    countryCode,
    disabled,
    isSubmitting,
    guessedPrice,
    onGuessSubmit,
    submitButtonScale,
    triggerSuccessHaptic,
  ]);

  // Quick adjustment handler
  const handleQuickAdjust = useCallback(
    (delta: number) => {
      if (disabled) return;

      markUserInteracted();
      const newPrice = clampPriceToRange(guessedPrice + delta, sliderRange);
      const newPosition = priceToPosition(newPrice, sliderRange);

      thumbPosition.value = withSpring(newPosition, { damping: 15 });
      updatePrice(newPosition);
      triggerSelectionHaptic();
    },
    [
      disabled,
      guessedPrice,
      markUserInteracted,
      sliderRange,
      thumbPosition,
      updatePrice,
      triggerSelectionHaptic,
    ]
  );

  // Only sync when the server-side submitted guess itself changes.
  useEffect(() => {
    if (userGuess === lastSyncedUserGuess.current || userGuess === undefined) {
      return;
    }

    lastSyncedUserGuess.current = userGuess;
    lastHapticPrice.current = userGuess;
    setSliderStartPrice(userGuess);
    setGuessedPrice(userGuess);
    const nextRange = resolveSliderRange({ officialValuation, startPrice: userGuess });
    thumbPosition.value = withSpring(priceToPosition(userGuess, nextRange), { damping: 15 });
    startAnalytics.current = buildStartAnalytics({
      price: userGuess,
      source: 'user_guess',
      confidence: 'submitted',
    });
  }, [officialValuation, userGuess, thumbPosition]);

  // Sync an asynchronously loaded initializer exactly once if the user has not interacted.
  useEffect(() => {
    if (
      initialPrice === undefined ||
      initialPriceSyncDone.current ||
      userGuess !== undefined ||
      resolvedAskingPrice !== undefined
    ) {
      return;
    }

    initialPriceSyncDone.current = true;
    if (hasUserInteracted.current) {
      return;
    }

    const source = initialPriceSource ?? 'initial_price';
    const confidence = resolveStartConfidence({
      source,
      initialPriceConfidence,
    });

    lastHapticPrice.current = initialPrice;
    setSliderStartPrice(initialPrice);
    setGuessedPrice(initialPrice);
    const nextRange = resolveSliderRange({ officialValuation, startPrice: initialPrice });
    thumbPosition.value = withSpring(priceToPosition(initialPrice, nextRange), { damping: 15 });
    startAnalytics.current = buildStartAnalytics({
      price: initialPrice,
      source,
      confidence,
      sampleSize: initialPriceSampleSize,
    });
  }, [
    initialPrice,
    initialPriceConfidence,
    initialPriceSampleSize,
    initialPriceSource,
    officialValuation,
    resolvedAskingPrice,
    thumbPosition,
    userGuess,
  ]);

  const showPreviousGuessReference = !hasSamePrice(userGuess, guessedPrice);

  // Calculate reference marker positions
  const wozPosition = officialValuation ? priceToPosition(officialValuation, sliderRange) : null;
  const askingPosition = askingPrice ? priceToPosition(askingPrice, sliderRange) : null;
  const fmvPosition = currentFMV ? priceToPosition(currentFMV, sliderRange) : null;
  const wozMarkerLabel = officialValuation
    ? formatMarkerLabel('WOZ', officialValuation, countryCode)
    : '';
  const askingMarkerLabel = askingPrice
    ? formatMarkerLabel('Asking', askingPrice, countryCode)
    : '';
  const crowdMarkerLabel = currentFMV
    ? formatMarkerLabel('Crowd', currentFMV, countryCode)
    : '';

  if (variant === 'embedded') {
    return (
      <GestureHandlerRootView>
        <View testID={testID}>
          <View className="mb-4" onLayout={handleSliderLayout}>
            <View className="relative mb-3.5 h-14">
              {showPreviousGuessReference && userGuess !== undefined ? (
                <View
                  className="absolute top-0 items-center"
                  style={{
                    left: `${priceToPosition(userGuess, sliderRange) * 100}%`,
                    transform: [{ translateX: -28 }],
                  }}
                  testID="previous-guess-bubble"
                >
                  <View
                    className="rounded-full border px-2.5 py-1"
                    style={{
                      backgroundColor: '#F4EFE8',
                      borderColor: '#D9D2C7',
                    }}
                  >
                    <Text
                      className="font-display-semibold text-[11px]"
                      style={{ color: '#7B7469' }}
                      numberOfLines={1}
                    >
                      {formatBubblePrice(userGuess, countryCode)}
                    </Text>
                  </View>
                </View>
              ) : null}
              <View
                className="absolute bottom-0 items-center"
                style={{
                  left: `${priceToPosition(guessedPrice, sliderRange) * 100}%`,
                  transform: [{ translateX: -32 }],
                }}
              >
                <View
                  className="rounded-xl px-3.5 py-1.5"
                  style={{ backgroundColor: disabled ? '#6D6C6A' : '#3D8A5A' }}
                >
                  <Text
                    className="font-display-semibold text-sm text-white"
                    numberOfLines={1}
                    testID="price-display"
                  >
                    {formatBubblePrice(guessedPrice, countryCode)}
                  </Text>
                </View>
                <View
                  style={{
                    width: 0,
                    height: 0,
                    borderLeftWidth: 6,
                    borderRightWidth: 6,
                    borderTopWidth: 7,
                    borderLeftColor: 'transparent',
                    borderRightColor: 'transparent',
                    borderTopColor: disabled ? '#6D6C6A' : '#3D8A5A',
                    marginTop: -1,
                  }}
                />
              </View>
            </View>

            <GestureDetector gesture={composedGestures}>
              <View
                className="relative"
                style={{ height: 28, overflow: 'visible' }}
              >
                <View
                  className="absolute left-0 right-0 rounded-full"
                  style={{
                    top: 10,
                    height: 8,
                    backgroundColor: '#E5E4E1',
                  }}
                />
                <Animated.View
                  className="absolute left-0 rounded-l-full"
                  style={[
                    fillAnimatedStyle,
                    {
                      top: 10,
                      height: 8,
                      backgroundColor: disabled ? '#BFC6C1' : '#9BD2B2',
                    },
                  ]}
                />

                <TrackMarker
                  position={wozPosition}
                  color="#9C9B99"
                  testID="woz-track-marker"
                  top={5}
                />
                <TrackMarker
                  position={askingPosition}
                  color="#9C9B99"
                  testID="asking-track-marker"
                  top={5}
                />
                <TrackMarker
                  position={fmvPosition}
                  color="#3D8A5A"
                  testID="crowd-track-marker"
                  top={5}
                />

                <Animated.View
                  className="absolute rounded-full"
                  style={[
                    thumbAnimatedStyle,
                    {
                      top: 0,
                      width: 28,
                      height: 28,
                      borderWidth: 3,
                      borderColor: disabled ? '#BFC6C1' : '#3D8A5A',
                      backgroundColor: '#FFFFFF',
                      shadowColor: '#1A1918',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.12,
                      shadowRadius: 8,
                      elevation: 4,
                    },
                  ]}
                  testID="slider-thumb"
                />
              </View>
            </GestureDetector>

            {(wozPosition !== null || askingPosition !== null || fmvPosition !== null) ? (
              <View className="relative h-14">
                <InlineReferenceLabel
                  position={wozPosition}
                  label={wozMarkerLabel}
                  color="#9C9B99"
                  connectorHeight={8}
                />
                <InlineReferenceLabel
                  position={askingPosition}
                  label={askingMarkerLabel}
                  color="#9C9B99"
                  connectorHeight={24}
                />
                <InlineReferenceLabel
                  position={fmvPosition}
                  label={crowdMarkerLabel}
                  color="#3D8A5A"
                  connectorHeight={40}
                />
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={disabled || isSubmitting}
            testID="submit-guess-button"
            className="w-full overflow-hidden rounded-xl"
            style={{
              backgroundColor: disabled || isSubmitting ? '#C8D9D0' : '#3D8A5A',
            }}
          >
            <View className="flex-row items-center justify-center py-3.5">
              <Animated.View style={submitAnimatedStyle}>
                {isSubmitting ? (
                  <View className="flex-row items-center">
                    <Icon name="Calendar" size={18} color="#F4FBF7" />
                    <Text className="ml-2 font-display-semibold text-base text-[#F4FBF7]">
                      Submitting...
                    </Text>
                  </View>
                ) : (
                  <Text className="font-display-semibold text-base text-white">
                    Submit Guess
                  </Text>
                )}
              </Animated.View>
            </View>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView>
      <View className="p-4 bg-surface-card rounded-xl" testID={testID}>
        {/* Header */}
        <Text
          className="text-lg font-semibold text-warm-900 mb-1"
          testID="price-guess-header"
        >
          What do you think this property is worth?
        </Text>

        {/* Reference values */}
        {officialValuation && (
          <Text className="text-sm text-warm-500 mb-4">
            {formatValuationLabel(countryCode, officialValuationYear)}:{' '}
            {formatPrice(officialValuation, countryCode)}
          </Text>
        )}

        {/* Price Display */}
        <Animated.View style={priceAnimatedStyle} className="items-center mb-6">
          <Text
            className={`text-4xl font-bold ${disabled ? 'text-warm-400' : 'text-primary-600'}`}
            testID="price-display"
          >
            {formatPrice(guessedPrice, countryCode)}
          </Text>
          {showPreviousGuessReference && userGuess !== undefined ? (
            <View
              className="mt-3 rounded-full border px-3 py-1"
              style={{
                backgroundColor: '#F7F2EA',
                borderColor: '#E1D8CC',
              }}
              testID="previous-guess-bubble"
            >
              <Text className="text-xs font-medium" style={{ color: '#7B7469' }}>
                Previous guess {formatBubblePrice(userGuess, countryCode)}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        {/* Slider */}
        <View className="mb-8 relative" style={{ paddingBottom: 74 }} onLayout={handleSliderLayout}>
          {/* Reference markers */}
          {wozPosition !== null && (
            <ReferenceMarker
              position={wozPosition}
              label={wozMarkerLabel}
              color="text-warm-400"
              isActive={isNearWOZ}
              top={15}
              connectorHeight={8}
            />
          )}
          {askingPosition !== null && (
            <ReferenceMarker
              position={askingPosition}
              label={askingMarkerLabel}
              color="text-orange-500"
              top={15}
              connectorHeight={24}
            />
          )}
          {fmvPosition !== null && (
            <ReferenceMarker
              position={fmvPosition}
              label={crowdMarkerLabel}
              color="text-primary-500"
              top={15}
              connectorHeight={40}
            />
          )}

          {/* Slider track container - overflow visible for thumb */}
          <GestureDetector gesture={composedGestures}>
            <View
              className="rounded-full bg-warm-200"
              style={{
                overflow: 'visible',
                position: 'relative',
                height: 12,
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
                    backgroundColor: disabled ? '#E8E0D4' : '#F5A623',
                  },
                ]}
              />

              <TrackMarker position={wozPosition} color="#9C9B99" testID="woz-track-marker" />
              <TrackMarker
                position={askingPosition}
                color="#F97316"
                testID="asking-track-marker"
              />
              <TrackMarker position={fmvPosition} color="#3D8A5A" testID="crowd-track-marker" />

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
                      ? '#C7BFB3'
                      : isNearWOZ
                        ? '#9C9B99'
                        : '#DE911D',
                  },
                ]}
                testID="slider-thumb"
              >
                <View className="flex-1 items-center justify-center">
                  <View className="w-1 h-3 bg-surface-card/50 rounded-full" />
                </View>
              </Animated.View>
            </View>
          </GestureDetector>
        </View>

        {/* Quick adjustment buttons */}
        <View className="flex-row justify-center gap-2 mb-4">
          {[-50000, -10000, 10000, 50000].map((delta) => (
            <Pressable
              key={delta}
              onPress={() => handleQuickAdjust(delta)}
              disabled={disabled}
              className={`px-3 py-2 rounded-lg ${
                disabled ? 'bg-warm-100' : 'bg-warm-100 active:bg-warm-200'
              }`}
              testID={`adjust-${delta > 0 ? 'plus' : 'minus'}-${Math.abs(delta / 1000)}k`}
            >
              <Text
                className={`text-sm font-medium ${disabled ? 'text-warm-300' : 'text-warm-700'}`}
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
          className={`w-full rounded-xl overflow-hidden flex-row items-center justify-center py-3.5 ${
            disabled || isSubmitting
              ? 'bg-warm-200'
              : 'bg-primary-500 active:bg-primary-600'
          }`}
        >
          <Animated.View style={submitAnimatedStyle}>
            {isSubmitting ? (
              <View className="flex-row items-center">
                <Icon name="Calendar" size={20} color="#C7BFB3" />
                <Text className="text-warm-500 font-semibold text-base ml-2">
                  Submitting...
                </Text>
              </View>
            ) : (
              <Text
                className={`font-semibold text-base ${
                  disabled ? 'text-warm-400' : 'text-white'
                }`}
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
