import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';

function SkeletonBlock({ className }: { className: string }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      className={`bg-gray-200 rounded ${className}`}
      style={animatedStyle}
    />
  );
}

export function LoadingSkeleton() {
  return (
    <View className="px-4 py-2">
      {/* Photo placeholder */}
      <SkeletonBlock className="h-48 rounded-xl mb-4" />

      {/* Address skeleton */}
      <SkeletonBlock className="h-6 w-3/4 mb-2" />
      <SkeletonBlock className="h-4 w-1/2 mb-4" />

      {/* Badges skeleton */}
      <View className="flex-row gap-2 mb-6">
        <SkeletonBlock className="h-8 w-24 rounded-full" />
        <SkeletonBlock className="h-8 w-20 rounded-full" />
      </View>

      {/* Price section skeleton */}
      <View className="flex-row mb-6">
        <View className="flex-1 mr-2">
          <SkeletonBlock className="h-3 w-16 mb-2" />
          <SkeletonBlock className="h-6 w-28" />
        </View>
        <View className="flex-1 ml-2">
          <SkeletonBlock className="h-3 w-16 mb-2" />
          <SkeletonBlock className="h-6 w-28" />
        </View>
      </View>

      {/* Actions skeleton */}
      <View className="flex-row gap-2 mb-6">
        <SkeletonBlock className="flex-1 h-12 rounded-xl" />
        <SkeletonBlock className="flex-1 h-12 rounded-xl" />
        <SkeletonBlock className="flex-1 h-12 rounded-xl" />
      </View>

      {/* Details skeleton */}
      <SkeletonBlock className="h-40 rounded-xl" />
    </View>
  );
}
