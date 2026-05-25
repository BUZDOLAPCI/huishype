import { View } from 'react-native';
import { SkeletonBlock } from '../ui/Skeleton';

export function LoadingSkeleton() {
  return (
    <View className="px-4 py-2">
      {/* Photo placeholder */}
      <SkeletonBlock className="h-48 mb-4" radius={12} />

      {/* Address skeleton */}
      <SkeletonBlock className="h-6 w-3/4 mb-2" />
      <SkeletonBlock className="h-4 w-1/2 mb-4" />

      {/* Badges skeleton */}
      <View className="flex-row gap-2 mb-6">
        <SkeletonBlock className="h-8 w-24" radius={999} />
        <SkeletonBlock className="h-8 w-20" radius={999} />
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
        <SkeletonBlock className="flex-1 h-12" radius={12} />
        <SkeletonBlock className="flex-1 h-12" radius={12} />
        <SkeletonBlock className="flex-1 h-12" radius={12} />
      </View>

      {/* Details skeleton */}
      <SkeletonBlock className="h-40" radius={12} />
    </View>
  );
}
