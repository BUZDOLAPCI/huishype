import React, { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

type SkeletonDimension = DimensionValue;

export interface SkeletonProps {
  width?: SkeletonDimension;
  height?: SkeletonDimension;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
  animated?: boolean;
  testID?: string;
}

const BASE_COLOR = '#E8E0D4';
const SHIMMER_COLORS = [
  'rgba(232, 224, 212, 0)',
  '#FFFDF9',
  'rgba(232, 224, 212, 0)',
] as const;
const SHIMMER_LOCATIONS = [0, 0.5, 1] as const;
const SHIMMER_DURATION_MS = 1000;

export function SkeletonBlock({
  width,
  height,
  radius = 6,
  style,
  className,
  animated = true,
  testID,
}: SkeletonProps) {
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animated && !reducedMotion;
  const shimmerProgress = useSharedValue(0);
  const [layoutWidth, setLayoutWidth] = useState(0);

  useEffect(() => {
    if (!shouldAnimate) {
      shimmerProgress.value = 0;
      return;
    }

    shimmerProgress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false
    );

    return undefined;
  }, [shouldAnimate, shimmerProgress]);

  const shimmerWidth = Math.max(layoutWidth * 0.55, 80);
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          shimmerProgress.value,
          [0, 1],
          [-shimmerWidth, layoutWidth + shimmerWidth],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    setLayoutWidth(event.nativeEvent.layout.width);
  };

  return (
    <View
      testID={testID}
      className={className}
      onLayout={handleLayout}
      style={[
        styles.block,
        {
          width,
          height,
          borderRadius: radius,
        },
        style,
      ]}
    >
      {shouldAnimate && layoutWidth > 0 ? (
        <Animated.View
          testID={testID ? `${testID}-shimmer` : undefined}
          pointerEvents="none"
          style={[
            styles.shimmer,
            {
              width: shimmerWidth,
              borderRadius: radius,
            },
            shimmerStyle,
          ]}
        >
          <LinearGradient
            colors={SHIMMER_COLORS}
            locations={SHIMMER_LOCATIONS}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

export function SkeletonText({
  height = 14,
  radius = 999,
  ...props
}: SkeletonProps) {
  return <SkeletonBlock height={height} radius={radius} {...props} />;
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: BASE_COLOR,
    overflow: 'hidden',
  },
  shimmer: {
    bottom: 0,
    position: 'absolute',
    top: 0,
  },
});
