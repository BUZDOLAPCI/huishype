import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, LayoutChangeEvent } from 'react-native';
import { Icon } from './ui/Icon';
import { SkeletonText } from './ui/Skeleton';
import Animated, {
  Easing,
  interpolateColor,
  type WithSpringConfig,
  cancelAnimation,
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
  officialValuationLoading?: boolean;
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
const COLOR_SWITCH_TIMING = {
  duration: 300,
  easing: Easing.out(Easing.cubic),
};
const FLOAT_REVEAL_TIMING = {
  duration: 220,
  easing: Easing.bezier(0.33, 1, 0.68, 1),
};
const HOVER_TIMING = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
};
const SLIDER_SPRING_CONFIG: WithSpringConfig = {
  damping: 18,
  stiffness: 165,
  mass: 0.85,
};
const THUMB_PRESS_SPRING_CONFIG: WithSpringConfig = {
  damping: 20,
  stiffness: 220,
  mass: 0.7,
};
const POSITIVE_GUESS_COLOR = '#3D8A5A';
const POSITIVE_GUESS_FILL_COLOR = POSITIVE_GUESS_COLOR;
const POSITIVE_GUESS_THUMB_COLOR = '#F0FAF4';
const NEUTRAL_GUESS_COLOR = '#4A40D4';
const NEUTRAL_GUESS_FILL_COLOR = NEUTRAL_GUESS_COLOR;
const NEUTRAL_GUESS_THUMB_COLOR = '#E5E2F9';
const NEGATIVE_GUESS_COLOR = '#A4493D';
const NEGATIVE_GUESS_FILL_COLOR = NEGATIVE_GUESS_COLOR;
const NEGATIVE_GUESS_THUMB_COLOR = '#FFF1F0';
const SLIDER_TRACK_COLOR = '#D7DADA';
const ASKING_REFERENCE_COLOR = NEUTRAL_GUESS_COLOR;
const YOU_REFERENCE_COLOR = '#FDAE10';
const START_ANCHOR_REFERENCE_COLOR = '#6F665D';
const START_ANCHOR_CONNECTOR_COLOR = '#C8BFB3';
const START_ANCHOR_MARKER_WIDTH = 160;
const EMBEDDED_REFERENCE_MARKER_WIDTH = 96;
const EMBEDDED_USER_REFERENCE_MARKER_WIDTH = 76;
const GUESS_TONE_INPUT_RANGE = [0, 0.5, 1];
const SLIDER_TRACK_HEIGHT = 6;
const TRACK_MARKER_HEIGHT = 18;
const SLIDER_THUMB_SIZE = 32;
const SLIDER_THUMB_RADIUS = SLIDER_THUMB_SIZE / 2;
const EMBEDDED_SLIDER_LANE_HEIGHT = SLIDER_THUMB_SIZE;
const EMBEDDED_TRACK_TOP = 13;
const EMBEDDED_TRACK_CENTER_Y = EMBEDDED_TRACK_TOP + SLIDER_TRACK_HEIGHT / 2;
const EMBEDDED_TRACK_MARKER_TOP = EMBEDDED_TRACK_CENTER_Y - TRACK_MARKER_HEIGHT / 2;
const EMBEDDED_THUMB_TOP = EMBEDDED_TRACK_CENTER_Y;
const EMBEDDED_THUMB_TRANSLATE_Y = -SLIDER_THUMB_RADIUS;
const EMBEDDED_REFERENCE_LABELS_HEIGHT = 76;
const EMBEDDED_EDGE_BLEED = 18;
const EMBEDDED_PERCENTAGE_BUBBLE_WIDTH = 116;
const EMBEDDED_PERCENTAGE_BUBBLE_CARET_WIDTH = 12;

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

function buildThumbSyncSignature(
  range: PriceGuessSliderRange,
  officialValuation?: number,
): string {
  return `${range.min}:${range.max}:${officialValuation ?? ''}`;
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

function formatStartAnchorLabel(
  source: PriceGuessSliderStartSource,
  price: number,
  countryCode?: string,
): string | null {
  if (
    source === 'official_valuation_adjusted' ||
    source === 'local_comparable_price_per_m2'
  ) {
    return formatMarkerLabel('Comparable homes', price, countryCode);
  }

  if (source === 'country_default' || source === 'initial_price') {
    return formatMarkerLabel('Starting', price, countryCode);
  }

  return null;
}

function isComparableStartSource(source: PriceGuessSliderStartSource): boolean {
  return (
    source === 'official_valuation_adjusted' ||
    source === 'local_comparable_price_per_m2'
  );
}

function formatDeltaPercentageLabel(price: number, startPrice: number): string {
  if (startPrice <= 0) {
    return '0%';
  }

  const percentage = ((price - startPrice) / startPrice) * 100;
  const rounded = Math.round(Math.abs(percentage) * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);

  if (percentage > 0) {
    return `+${formatted}% overbid`;
  }
  if (percentage < 0) {
    return `-${formatted}% underbid`;
  }
  return '0%';
}

function hasSamePrice(left?: number, right?: number): boolean {
  return left !== undefined && right !== undefined && left === right;
}

function buildInitialPriceSignature({
  price,
  source,
  confidence,
  sampleSize,
}: {
  price: number;
  source?: PriceGuessSliderStartSource;
  confidence?: PriceGuessSliderStartConfidence;
  sampleSize?: number;
}): string {
  return `${price}:${source ?? 'initial_price'}:${confidence ?? ''}:${sampleSize ?? ''}`;
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

function clampNumber(value: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

function getAnchoredBoxLeft({
  markerX,
  boxWidth,
  trackWidth,
  edgeBleed = 0,
}: {
  markerX: number;
  boxWidth: number;
  trackWidth: number;
  edgeBleed?: number;
}): number {
  'worklet';
  const maxLeft = trackWidth - boxWidth + edgeBleed;
  return clampNumber(markerX - boxWidth / 2, -edgeBleed, Math.max(-edgeBleed, maxLeft));
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
  textColor,
  isActive,
  top,
  connectorHeight,
  connectorColor = '#D9D4CC',
  width = 112,
}: {
  position: number;
  label: string;
  color: string;
  textColor?: string;
  isActive?: boolean;
  top: number;
  connectorHeight: number;
  connectorColor?: string;
  width?: number;
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
    transform: [{ translateX: -width / 2 }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      className="absolute items-center"
      style={[
        { left: `${position * 100}%`, top, width },
        markerStyle,
      ]}
    >
      <View
        style={{
          width: 1,
          height: connectorHeight,
          backgroundColor: connectorColor,
        }}
      />
      <Text
        className={`text-xs text-center ${color}`}
        numberOfLines={1}
        style={textColor ? { color: textColor } : undefined}
      >
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
  connectorColor = '#D9D4CC',
  connectorTopGap = 0,
  fontSize = 12,
  lineHeight = 16,
  width = EMBEDDED_REFERENCE_MARKER_WIDTH,
  trackWidth = 300,
  edgeBleed = 0,
  testID,
}: {
  position: number | null;
  label: string;
  color: string;
  connectorHeight: number;
  connectorColor?: string;
  connectorTopGap?: number;
  fontSize?: number;
  lineHeight?: number;
  width?: number;
  trackWidth?: number;
  edgeBleed?: number;
  testID?: string;
}) {
  if (position === null) {
    return null;
  }

  const visibleConnectorHeight = Math.max(0, connectorHeight - connectorTopGap);
  const markerX = position * trackWidth;
  const labelLeft = getAnchoredBoxLeft({
    markerX,
    boxWidth: width,
    trackWidth,
    edgeBleed,
  });

  return (
    <View
      className="absolute"
      testID={testID}
      style={{
        left: 0,
        top: 0,
        width: trackWidth,
        height: connectorHeight + lineHeight,
        overflow: 'visible',
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: markerX,
          top: connectorTopGap,
          width: 1,
          height: visibleConnectorHeight,
          backgroundColor: connectorColor,
        }}
      />
      <Text
        className="absolute font-display"
        numberOfLines={1}
        style={{
          left: labelLeft,
          top: connectorHeight,
          width,
          color,
          fontSize,
          lineHeight,
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
        position: 'absolute',
        top,
        width: 2,
        height: TRACK_MARKER_HEIGHT,
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
  officialValuationLoading = false,
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
  const [hasInteracted, setHasInteracted] = useState(false);

  // Animation values - use shared value for slider width for proper animated style updates
  const sliderWidthShared = useSharedValue(300);
  const [sliderWidth, setSliderWidth] = useState(300);
  const thumbPosition = useSharedValue(priceToPosition(resolvedInitialPrice, sliderRange));
  const thumbScale = useSharedValue(1);
  const thumbPulse = useSharedValue(1);
  const thumbHoverProgress = useSharedValue(0);
  const thumbPressProgress = useSharedValue(0);
  const floatingLabelProgress = useSharedValue(0);
  const guessToneProgress = useSharedValue(0.5);
  const priceDisplayScale = useSharedValue(1);
  const submitButtonScale = useSharedValue(1);
  const isDragging = useSharedValue(false);

  // Refs
  const hasUserInteracted = useRef(false);
  const lastInitialPriceSignature = useRef(
    initialPrice !== undefined
      ? buildInitialPriceSignature({
          price: initialPrice,
          source: initialPriceSource,
          confidence: initialPriceConfidence,
          sampleSize: initialPriceSampleSize,
        })
      : null
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
  const lastPropertyId = useRef(_propertyId);
  const lastThumbSyncSignature = useRef(
    buildThumbSyncSignature(sliderRange, officialValuation),
  );

  const syncThumbPositionToGuessedPrice = useCallback(() => {
    const nextPosition = priceToPosition(guessedPrice, sliderRange);
    cancelAnimation(thumbPosition);
    thumbPosition.value = nextPosition;

    const nextIsNearWOZ = officialValuation
      ? isNear(nextPosition, priceToPosition(officialValuation, sliderRange))
      : false;
    setIsNearWOZ((current) => (current === nextIsNearWOZ ? current : nextIsNearWOZ));
  }, [guessedPrice, officialValuation, sliderRange, thumbPosition]);

  useLayoutEffect(() => {
    const nextSignature = buildThumbSyncSignature(sliderRange, officialValuation);
    if (lastThumbSyncSignature.current === nextSignature) {
      return;
    }

    lastThumbSyncSignature.current = nextSignature;
    if (isDragging.value) {
      return;
    }

    syncThumbPositionToGuessedPrice();
  }, [isDragging, officialValuation, sliderRange, syncThumbPositionToGuessedPrice]);

  useLayoutEffect(() => {
    if (lastPropertyId.current === _propertyId) {
      return;
    }

    lastPropertyId.current = _propertyId;
    hasUserInteracted.current = false;
    lastInitialPriceSignature.current =
      initialPrice !== undefined
        ? buildInitialPriceSignature({
            price: initialPrice,
            source: initialPriceSource,
            confidence: initialPriceConfidence,
            sampleSize: initialPriceSampleSize,
          })
        : null;
    hasLoggedShown.current = false;
    lastHapticPrice.current = resolvedInitialPrice;
    lastWOZCrossing.current = null;
    lastSyncedUserGuess.current = userGuess;
    setSliderStartPrice(resolvedInitialPrice);
    setGuessedPrice(resolvedInitialPrice);
    setIsNearWOZ(false);
    setHasInteracted(false);
    const nextRange = resolveSliderRange({ officialValuation, startPrice: resolvedInitialPrice });
    cancelAnimation(thumbPosition);
    cancelAnimation(thumbScale);
    cancelAnimation(thumbPulse);
    cancelAnimation(thumbHoverProgress);
    cancelAnimation(thumbPressProgress);
    cancelAnimation(floatingLabelProgress);
    cancelAnimation(guessToneProgress);
    cancelAnimation(priceDisplayScale);
    cancelAnimation(submitButtonScale);
    thumbScale.value = 1;
    thumbPulse.value = 1;
    thumbHoverProgress.value = 0;
    thumbPressProgress.value = 0;
    floatingLabelProgress.value = 0;
    guessToneProgress.value = 0.5;
    priceDisplayScale.value = 1;
    submitButtonScale.value = 1;
    isDragging.value = false;
    thumbPosition.value = priceToPosition(resolvedInitialPrice, nextRange);
    lastThumbSyncSignature.current = buildThumbSyncSignature(nextRange, officialValuation);
    startAnalytics.current = buildStartAnalytics({
      price: resolvedInitialPrice,
      source: resolvedStartSource,
      confidence: resolvedStartConfidence,
      sampleSize: initialPriceSampleSize,
    });
  }, [
    _propertyId,
    initialPrice,
    initialPriceConfidence,
    initialPriceSampleSize,
    initialPriceSource,
    officialValuation,
    resolvedAskingPrice,
    resolvedInitialPrice,
    resolvedStartConfidence,
    resolvedStartSource,
    floatingLabelProgress,
    guessToneProgress,
    isDragging,
    priceDisplayScale,
    submitButtonScale,
    thumbHoverProgress,
    thumbPosition,
    thumbPressProgress,
    thumbPulse,
    thumbScale,
    userGuess,
  ]);

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
    setHasInteracted(true);
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
      thumbPressProgress.value = withTiming(1, HOVER_TIMING);
      floatingLabelProgress.value = withTiming(1, FLOAT_REVEAL_TIMING);
      thumbScale.value = withSpring(1.18, THUMB_PRESS_SPRING_CONFIG);
    })
    .onUpdate((event) => {
      const newPosition = Math.max(0, Math.min(1, event.x / sliderWidth));
      thumbPosition.value = newPosition;
      runOnJS(updatePrice)(newPosition);
    })
    .onEnd(() => {
      isDragging.value = false;
      thumbPressProgress.value = withTiming(0, HOVER_TIMING);
      if (thumbHoverProgress.value === 0) {
        floatingLabelProgress.value = withTiming(0, FLOAT_REVEAL_TIMING);
      }
      thumbScale.value = withSpring(1, THUMB_PRESS_SPRING_CONFIG);
      runOnJS(syncThumbPositionToGuessedPrice)();
    });

  // Tap gesture for track
  const tapGesture = Gesture.Tap()
    .enabled(!disabled)
    .onBegin(() => {
      thumbPressProgress.value = withTiming(1, HOVER_TIMING);
      floatingLabelProgress.value = withTiming(1, FLOAT_REVEAL_TIMING);
    })
    .onEnd((event) => {
      runOnJS(markUserInteracted)();
      const newPosition = Math.max(0, Math.min(1, event.x / sliderWidth));
      thumbPosition.value = withSpring(newPosition, SLIDER_SPRING_CONFIG);
      runOnJS(updatePrice)(newPosition);
      runOnJS(triggerSelectionHaptic)();
    })
    .onFinalize(() => {
      thumbPressProgress.value = withTiming(0, HOVER_TIMING);
      if (!isDragging.value && thumbHoverProgress.value === 0) {
        floatingLabelProgress.value = withTiming(0, FLOAT_REVEAL_TIMING);
      }
    });

  const hoverGesture = Gesture.Hover()
    .enabled(!disabled)
    .onBegin(() => {
      thumbHoverProgress.value = withTiming(1, HOVER_TIMING);
      floatingLabelProgress.value = withTiming(1, FLOAT_REVEAL_TIMING);
    })
    .onFinalize(() => {
      thumbHoverProgress.value = withTiming(0, HOVER_TIMING);
      if (!isDragging.value && thumbPressProgress.value === 0) {
        floatingLabelProgress.value = withTiming(0, FLOAT_REVEAL_TIMING);
      }
    });

  // Combined gestures
  const composedGestures = Gesture.Simultaneous(panGesture, tapGesture, hoverGesture);

  // Thumb animated styles - use pixel positioning for web compatibility
  const thumbAnimatedStyle = useAnimatedStyle(() => {
    const leftPx = thumbPosition.value * sliderWidthShared.value;
    return {
      left: leftPx,
      transform: [
        { translateX: -SLIDER_THUMB_RADIUS },
        { scale: thumbScale.value * thumbPulse.value },
      ],
    };
  });

  const embeddedThumbAnimatedStyle = useAnimatedStyle(() => {
    const leftPx = thumbPosition.value * sliderWidthShared.value;
    return {
      left: leftPx,
      transform: [
        { translateX: -SLIDER_THUMB_RADIUS },
        { translateY: EMBEDDED_THUMB_TRANSLATE_Y },
        { scale: thumbScale.value * thumbPulse.value },
      ],
    };
  });

  const startPosition = priceToPosition(sliderStartPrice, sliderRange);
  const guessedPosition = priceToPosition(guessedPrice, sliderRange);
  const guessedDelta = guessedPrice - sliderStartPrice;
  const guessTone =
    guessedDelta > 0 ? 'positive' : guessedDelta < 0 ? 'negative' : 'neutral';
  const guessToneTarget =
    guessTone === 'positive' ? 1 : guessTone === 'negative' ? 0 : 0.5;
  const percentageLabel = formatDeltaPercentageLabel(guessedPrice, sliderStartPrice);
  const submitDisabled = disabled || isSubmitting || !hasInteracted;
  const needsSliderInteraction = !disabled && !isSubmitting && !hasInteracted;
  const submitButtonLabel = needsSliderInteraction
    ? 'Drag Slider to Adjust Guess'
    : 'Submit Guess';

  useEffect(() => {
    guessToneProgress.value = withTiming(guessToneTarget, COLOR_SWITCH_TIMING);
  }, [guessToneProgress, guessToneTarget]);

  // Track fill animated style - use pixel offsets for web compatibility.
  const fillAnimatedStyle = useAnimatedStyle(() => {
    const startPx = startPosition * sliderWidthShared.value;
    const thumbPx = thumbPosition.value * sliderWidthShared.value;
    const leftPx = Math.min(startPx, thumbPx);
    const widthPx = Math.abs(thumbPx - startPx);
    return {
      left: leftPx,
      width: widthPx,
    };
  });

  const fillColorAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: disabled
      ? '#BFC6C1'
      : interpolateColor(
        guessToneProgress.value,
        GUESS_TONE_INPUT_RANGE,
        [
          NEGATIVE_GUESS_FILL_COLOR,
          NEUTRAL_GUESS_FILL_COLOR,
          POSITIVE_GUESS_FILL_COLOR,
        ],
      ),
  }));

  const percentageBubbleColorAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: disabled
      ? '#6D6C6A'
      : interpolateColor(
        guessToneProgress.value,
        GUESS_TONE_INPUT_RANGE,
        [NEGATIVE_GUESS_COLOR, NEUTRAL_GUESS_COLOR, POSITIVE_GUESS_COLOR],
      ),
  }));

  const percentageBubbleCaretAnimatedStyle = useAnimatedStyle(() => ({
    borderTopColor: disabled
      ? '#6D6C6A'
      : interpolateColor(
        guessToneProgress.value,
        GUESS_TONE_INPUT_RANGE,
        [NEGATIVE_GUESS_COLOR, NEUTRAL_GUESS_COLOR, POSITIVE_GUESS_COLOR],
      ),
  }));

  const thumbNubAnimatedStyle = useAnimatedStyle(() => ({
    borderColor: disabled
      ? '#BFC6C1'
      : interpolateColor(
        guessToneProgress.value,
        GUESS_TONE_INPUT_RANGE,
        [NEGATIVE_GUESS_COLOR, NEUTRAL_GUESS_COLOR, POSITIVE_GUESS_COLOR],
      ),
    backgroundColor: disabled
      ? '#F4F3F0'
      : interpolateColor(
        guessToneProgress.value,
        GUESS_TONE_INPUT_RANGE,
        [
          NEGATIVE_GUESS_THUMB_COLOR,
          NEUTRAL_GUESS_THUMB_COLOR,
          POSITIVE_GUESS_THUMB_COLOR,
        ],
      ),
  }));

  const thumbHaloAnimatedStyle = useAnimatedStyle(() => {
    const hoverOpacity = thumbHoverProgress.value * 0.2;
    const pressOpacity = thumbPressProgress.value * 0.4;
    const hoverScale = 1 + thumbHoverProgress.value * 0.5;
    const pressScale = 1 + thumbPressProgress.value * 0.75;

    return {
      opacity: Math.max(hoverOpacity, pressOpacity),
      transform: [{ scale: Math.max(hoverScale, pressScale) }],
      backgroundColor: interpolateColor(
        guessToneProgress.value,
        GUESS_TONE_INPUT_RANGE,
        [NEGATIVE_GUESS_COLOR, NEUTRAL_GUESS_COLOR, POSITIVE_GUESS_COLOR],
      ),
    };
  });

  const percentageBubblePositionAnimatedStyle = useAnimatedStyle(() => ({
    left: getAnchoredBoxLeft({
      markerX: thumbPosition.value * sliderWidthShared.value,
      boxWidth: EMBEDDED_PERCENTAGE_BUBBLE_WIDTH,
      trackWidth: sliderWidthShared.value,
      edgeBleed: EMBEDDED_EDGE_BLEED,
    }),
    opacity: 1,
    transform: [
      { translateY: -8 + floatingLabelProgress.value * 8 },
      { scale: priceDisplayScale.value },
    ],
  }));

  const percentageBubbleCaretPositionAnimatedStyle = useAnimatedStyle(() => {
    const markerX = thumbPosition.value * sliderWidthShared.value;
    const bubbleLeft = getAnchoredBoxLeft({
      markerX,
      boxWidth: EMBEDDED_PERCENTAGE_BUBBLE_WIDTH,
      trackWidth: sliderWidthShared.value,
      edgeBleed: EMBEDDED_EDGE_BLEED,
    });
    const caretCenterX = clampNumber(
      markerX - bubbleLeft,
      12,
      EMBEDDED_PERCENTAGE_BUBBLE_WIDTH - 12,
    );

    return {
      left: caretCenterX - EMBEDDED_PERCENTAGE_BUBBLE_CARET_WIDTH / 2,
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
    if (submitDisabled) return;

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
    guessedPrice,
    onGuessSubmit,
    submitDisabled,
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

      thumbPosition.value = withSpring(newPosition, SLIDER_SPRING_CONFIG);
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
    setHasInteracted(false);
    const nextRange = resolveSliderRange({ officialValuation, startPrice: userGuess });
    cancelAnimation(thumbPosition);
    thumbPosition.value = withSpring(priceToPosition(userGuess, nextRange), SLIDER_SPRING_CONFIG);
    lastThumbSyncSignature.current = buildThumbSyncSignature(nextRange, officialValuation);
    startAnalytics.current = buildStartAnalytics({
      price: userGuess,
      source: 'user_guess',
      confidence: 'submitted',
    });
  }, [officialValuation, userGuess, thumbPosition]);

  // Keep async baseline changes coupled to the selected thumb until the user makes a guess.
  useLayoutEffect(() => {
    if (
      initialPrice === undefined ||
      userGuess !== undefined ||
      resolvedAskingPrice !== undefined
    ) {
      return;
    }

    const source = initialPriceSource ?? 'initial_price';
    const confidence = resolveStartConfidence({
      source,
      initialPriceConfidence,
    });
    const signature = buildInitialPriceSignature({
      price: initialPrice,
      source,
      confidence: initialPriceConfidence,
      sampleSize: initialPriceSampleSize,
    });
    if (
      lastInitialPriceSignature.current === signature &&
      hasSamePrice(sliderStartPrice, initialPrice) &&
      hasSamePrice(guessedPrice, initialPrice)
    ) {
      return;
    }

    lastInitialPriceSignature.current = signature;
    if (hasUserInteracted.current) {
      return;
    }

    lastHapticPrice.current = initialPrice;
    setSliderStartPrice(initialPrice);
    setGuessedPrice(initialPrice);
    const nextRange = resolveSliderRange({ officialValuation, startPrice: initialPrice });
    cancelAnimation(thumbPosition);
    thumbPosition.value = priceToPosition(initialPrice, nextRange);
    lastThumbSyncSignature.current = buildThumbSyncSignature(nextRange, officialValuation);
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
    guessedPrice,
    sliderStartPrice,
    thumbPosition,
    userGuess,
  ]);

  useLayoutEffect(() => {
    if (
      officialValuation === undefined ||
      initialPrice !== undefined ||
      userGuess !== undefined ||
      resolvedAskingPrice !== undefined ||
      hasUserInteracted.current
    ) {
      return;
    }

    lastHapticPrice.current = officialValuation;
    setSliderStartPrice(officialValuation);
    setGuessedPrice(officialValuation);
    const nextRange = resolveSliderRange({ officialValuation, startPrice: officialValuation });
    cancelAnimation(thumbPosition);
    thumbPosition.value = priceToPosition(officialValuation, nextRange);
    lastThumbSyncSignature.current = buildThumbSyncSignature(nextRange, officialValuation);
    startAnalytics.current = buildStartAnalytics({
      price: officialValuation,
      source: 'official_valuation',
      confidence: 'usable',
    });
  }, [initialPrice, officialValuation, resolvedAskingPrice, thumbPosition, userGuess]);

  const showPreviousGuessReference = !hasSamePrice(userGuess, guessedPrice);

  // Calculate reference marker positions
  const wozPosition = officialValuation ? priceToPosition(officialValuation, sliderRange) : null;
  const askingPosition = askingPrice ? priceToPosition(askingPrice, sliderRange) : null;
  const fmvPosition = currentFMV ? priceToPosition(currentFMV, sliderRange) : null;
  const valuationMarkerPrefix =
    !countryCode || countryCode.toUpperCase() === 'NL'
      ? 'WOZ'
      : getValuationLabel(countryCode).split(' ')[0] || 'Official';
  const wozMarkerLabel = officialValuation
    ? formatMarkerLabel(valuationMarkerPrefix, officialValuation, countryCode)
    : '';
  const askingMarkerLabel = askingPrice
    ? formatMarkerLabel('Asking', askingPrice, countryCode)
    : '';
  const crowdMarkerLabel = currentFMV
    ? formatMarkerLabel('Crowd', currentFMV, countryCode)
    : '';
  const candidateStartAnchorLabel = formatStartAnchorLabel(
    startAnalytics.current.source,
    sliderStartPrice,
    countryCode,
  );
  const startAnchorLabel =
    candidateStartAnchorLabel &&
      !hasSamePrice(sliderStartPrice, resolvedAskingPrice) &&
      !hasSamePrice(sliderStartPrice, officialValuation) &&
      !hasSamePrice(sliderStartPrice, userGuess)
      ? candidateStartAnchorLabel
      : null;
  const startAnchorPosition = startAnchorLabel
    ? priceToPosition(sliderStartPrice, sliderRange)
    : null;
  const startAnchorUsesAskingStyle = isComparableStartSource(startAnalytics.current.source);
  const startAnchorReferenceColor = startAnchorUsesAskingStyle
    ? ASKING_REFERENCE_COLOR
    : START_ANCHOR_REFERENCE_COLOR;
  const startAnchorConnectorColor = startAnchorUsesAskingStyle
    ? ASKING_REFERENCE_COLOR
    : START_ANCHOR_CONNECTOR_COLOR;
  const startAnchorConnectorHeight = startAnchorUsesAskingStyle ? 24 : 52;

  if (variant === 'embedded') {
    return (
      <GestureHandlerRootView key={_propertyId} style={{ overflow: 'visible' }}>
        <View testID={testID} style={{ overflow: 'visible' }}>
          <View className="mb-4" onLayout={handleSliderLayout} style={{ overflow: 'visible' }}>
            <View className="relative mb-3.5 h-14" style={{ overflow: 'visible' }}>
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
              <Animated.View
                className="absolute bottom-0 items-center"
                style={[
                  {
                    alignItems: 'center',
                    bottom: 0,
                    position: 'absolute',
                    width: EMBEDDED_PERCENTAGE_BUBBLE_WIDTH,
                  },
                  percentageBubblePositionAnimatedStyle,
                ]}
                testID="price-percentage-bubble"
              >
                <Animated.View
                  style={[
                    {
                      alignSelf: 'center',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 74,
                      minHeight: 30,
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 12,
                    },
                    percentageBubbleColorAnimatedStyle,
                  ]}
                >
                  <Animated.Text
                    className="font-display-semibold"
                    numberOfLines={1}
                    testID="price-display"
                    style={{
                      color: '#FFFFFF',
                      fontSize: 14,
                      lineHeight: 18,
                      textAlign: 'center',
                    }}
                  >
                    {percentageLabel}
                  </Animated.Text>
                </Animated.View>
                <Animated.View
                  style={[
                    {
                      position: 'absolute',
                      top: 29,
                      width: 0,
                      height: 0,
                      borderLeftWidth: 6,
                      borderRightWidth: 6,
                      borderTopWidth: 7,
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                    },
                    percentageBubbleCaretPositionAnimatedStyle,
                    percentageBubbleCaretAnimatedStyle,
                  ]}
                />
              </Animated.View>
            </View>

            <GestureDetector gesture={composedGestures}>
              <View
                className="relative"
                style={{ height: EMBEDDED_SLIDER_LANE_HEIGHT, overflow: 'visible' }}
              >
                <View
                  className="absolute left-0 right-0 rounded-full"
                  style={{
                    left: 0,
                    position: 'absolute',
                    right: 0,
                    top: EMBEDDED_TRACK_TOP,
                    height: SLIDER_TRACK_HEIGHT,
                    backgroundColor: SLIDER_TRACK_COLOR,
                  }}
                />
                <Animated.View
                  className="absolute rounded-full"
                  style={[
                    fillAnimatedStyle,
                    fillColorAnimatedStyle,
                    {
                      height: SLIDER_TRACK_HEIGHT,
                      position: 'absolute',
                      top: EMBEDDED_TRACK_TOP,
                    },
                  ]}
                />

                <TrackMarker
                  position={wozPosition}
                  color="#9C9B99"
                  testID="woz-track-marker"
                  top={EMBEDDED_TRACK_MARKER_TOP}
                />
                <TrackMarker
                  position={askingPosition}
                  color={ASKING_REFERENCE_COLOR}
                  testID="asking-track-marker"
                  top={EMBEDDED_TRACK_MARKER_TOP}
                />
                <TrackMarker
                  position={fmvPosition}
                  color="#3D8A5A"
                  testID="crowd-track-marker"
                  top={EMBEDDED_TRACK_MARKER_TOP}
                />
                <TrackMarker
                  position={startAnchorPosition}
                  color={START_ANCHOR_REFERENCE_COLOR}
                  testID="start-anchor-track-marker"
                  top={EMBEDDED_TRACK_MARKER_TOP}
                />

                <Animated.View
                  className="absolute"
                  style={[
                    embeddedThumbAnimatedStyle,
                    {
                      position: 'absolute',
                      top: EMBEDDED_THUMB_TOP,
                      width: SLIDER_THUMB_SIZE,
                      height: SLIDER_THUMB_SIZE,
                    },
                  ]}
                  testID="slider-thumb"
                >
                  <Animated.View
                    pointerEvents="none"
                    className="absolute rounded-full"
                    style={[
                      {
                        left: 0,
                        position: 'absolute',
                        top: 0,
                        width: SLIDER_THUMB_SIZE,
                        height: SLIDER_THUMB_SIZE,
                        borderRadius: SLIDER_THUMB_RADIUS,
                      },
                      thumbHaloAnimatedStyle,
                    ]}
                  />
                  <Animated.View
                    className="absolute rounded-full"
                    style={[
                      {
                        left: 0,
                        position: 'absolute',
                        top: 0,
                        width: SLIDER_THUMB_SIZE,
                        height: SLIDER_THUMB_SIZE,
                        borderRadius: SLIDER_THUMB_RADIUS,
                        borderWidth: 5,
                      },
                      thumbNubAnimatedStyle,
                    ]}
                  />
                </Animated.View>
              </View>
            </GestureDetector>

            <View
              className="relative"
              testID="guess-reference-labels"
              style={{ height: EMBEDDED_REFERENCE_LABELS_HEIGHT }}
            >
              <InlineReferenceLabel
                position={wozPosition}
                label={wozMarkerLabel}
                color="#9C9B99"
                connectorHeight={8}
                trackWidth={sliderWidth}
                edgeBleed={EMBEDDED_EDGE_BLEED}
              />
              <InlineReferenceLabel
                position={askingPosition}
                label={askingMarkerLabel}
                color={ASKING_REFERENCE_COLOR}
                connectorColor={ASKING_REFERENCE_COLOR}
                connectorHeight={24}
                trackWidth={sliderWidth}
                edgeBleed={EMBEDDED_EDGE_BLEED}
              />
              <InlineReferenceLabel
                position={fmvPosition}
                label={crowdMarkerLabel}
                color="#3D8A5A"
                connectorHeight={40}
                trackWidth={sliderWidth}
                edgeBleed={EMBEDDED_EDGE_BLEED}
              />
              <InlineReferenceLabel
                position={startAnchorPosition}
                label={startAnchorLabel ?? ''}
                color={startAnchorReferenceColor}
                connectorColor={startAnchorConnectorColor}
                connectorHeight={startAnchorConnectorHeight}
                width={START_ANCHOR_MARKER_WIDTH}
                trackWidth={sliderWidth}
                edgeBleed={EMBEDDED_EDGE_BLEED}
                testID="start-anchor-marker"
              />
              {hasInteracted ? (
                <InlineReferenceLabel
                  position={guessedPosition}
                  label={`You ${formatBubblePrice(guessedPrice, countryCode)}`}
                  color={YOU_REFERENCE_COLOR}
                  connectorColor={YOU_REFERENCE_COLOR}
                  connectorHeight={60}
                  connectorTopGap={4}
                  fontSize={13}
                  lineHeight={17}
                  width={EMBEDDED_USER_REFERENCE_MARKER_WIDTH}
                  trackWidth={sliderWidth}
                  edgeBleed={EMBEDDED_EDGE_BLEED}
                  testID="user-guess-marker"
                />
              ) : null}
            </View>
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={submitDisabled}
            testID="submit-guess-button"
            className="w-full overflow-hidden rounded-xl"
            style={{
              backgroundColor: submitDisabled ? '#C8D9D0' : '#3D8A5A',
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
                    {submitButtonLabel}
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
    <GestureHandlerRootView key={_propertyId}>
      <View className="p-4 bg-surface-card rounded-xl" testID={testID}>
        {/* Header */}
        <Text
          className="text-lg font-semibold text-warm-900 mb-1"
          testID="price-guess-header"
        >
          What do you think this property is worth?
        </Text>

        {/* Reference values */}
        {(officialValuation || officialValuationLoading) && (
          <View className="mb-4 flex-row items-center">
            <Text className="text-sm text-warm-500">
              {formatValuationLabel(countryCode, officialValuationYear)}:{' '}
            </Text>
            {officialValuationLoading ? (
              <SkeletonText
                testID="price-guess-valuation-value-skeleton"
                width={72}
                height={14}
              />
            ) : officialValuation ? (
              <Text className="text-sm text-warm-500">
                {formatPrice(officialValuation, countryCode)}
              </Text>
            ) : null}
          </View>
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
              textColor={ASKING_REFERENCE_COLOR}
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
          {startAnchorLabel !== null && startAnchorPosition !== null && (
            <ReferenceMarker
              position={startAnchorPosition}
              label={startAnchorLabel}
              color="text-warm-600"
              textColor={startAnchorReferenceColor}
              connectorColor={startAnchorConnectorColor}
              top={15}
              connectorHeight={startAnchorConnectorHeight}
              width={START_ANCHOR_MARKER_WIDTH}
            />
          )}
          {hasInteracted && (
            <ReferenceMarker
              position={guessedPosition}
              label={`You ${formatBubblePrice(guessedPrice, countryCode)}`}
              color="text-primary-500"
              top={15}
              connectorHeight={56}
            />
          )}

          {/* Slider track container - overflow visible for thumb */}
          <GestureDetector gesture={composedGestures}>
            <View
              className="rounded-full bg-warm-200"
              style={{
                overflow: 'visible',
                position: 'relative',
                height: 6,
                backgroundColor: SLIDER_TRACK_COLOR,
              }}
            >
              {/* Fill */}
              <Animated.View
                className="rounded-full"
                style={[
                  fillAnimatedStyle,
                  fillColorAnimatedStyle,
                  { position: 'absolute', top: 0, height: 6 },
                ]}
              />

              <TrackMarker position={wozPosition} color="#9C9B99" testID="woz-track-marker" />
              <TrackMarker
                position={askingPosition}
                color={ASKING_REFERENCE_COLOR}
                testID="asking-track-marker"
              />
              <TrackMarker position={fmvPosition} color="#3D8A5A" testID="crowd-track-marker" />
              <TrackMarker
                position={startAnchorPosition}
                color={START_ANCHOR_REFERENCE_COLOR}
                testID="start-anchor-track-marker"
              />

              {/* Thumb */}
              <Animated.View
                className="shadow-lg"
                style={[
                  thumbAnimatedStyle,
                  {
                    position: 'absolute',
                    top: -13,
                    width: 32,
                    height: 32,
                    zIndex: 10,
                  },
                ]}
                testID="slider-thumb"
              >
                <Animated.View
                  pointerEvents="none"
                  className="absolute rounded-full"
                  style={[
                    {
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                    },
                    thumbHaloAnimatedStyle,
                  ]}
                />
                <Animated.View
                  className="absolute rounded-full"
                  style={[
                    {
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      borderWidth: 5,
                    },
                    thumbNubAnimatedStyle,
                  ]}
                />
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
              className={`px-3 py-2 rounded-lg ${disabled ? 'bg-warm-100' : 'bg-warm-100 active:bg-warm-200'
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
          disabled={submitDisabled}
          testID="submit-guess-button"
          className={`w-full rounded-xl overflow-hidden flex-row items-center justify-center py-3.5 ${submitDisabled
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
                className={`font-semibold text-base ${submitDisabled ? 'text-warm-400' : 'text-white'
                  }`}
              >
                {submitButtonLabel}
              </Text>
            )}
          </Animated.View>
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
}
