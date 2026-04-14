import { View } from '../../runtime/dom';

function SkeletonBlock({ className }: { className: string }) {
  return <View className={`bg-warm-200 rounded ${className}`} />;
}

export function LoadingSkeleton() {
  return (
    <View className="px-4 py-2">
      <SkeletonBlock className="h-48 rounded-xl mb-4 animate-pulse" />
      <SkeletonBlock className="h-6 w-3/4 mb-2 animate-pulse" />
      <SkeletonBlock className="h-4 w-1/2 mb-4 animate-pulse" />

      <View className="flex-row gap-2 mb-6">
        <SkeletonBlock className="h-8 w-24 rounded-full animate-pulse" />
        <SkeletonBlock className="h-8 w-20 rounded-full animate-pulse" />
      </View>

      <View className="flex-row mb-6">
        <View className="flex-1 mr-2">
          <SkeletonBlock className="h-3 w-16 mb-2 animate-pulse" />
          <SkeletonBlock className="h-6 w-28 animate-pulse" />
        </View>
        <View className="flex-1 ml-2">
          <SkeletonBlock className="h-3 w-16 mb-2 animate-pulse" />
          <SkeletonBlock className="h-6 w-28 animate-pulse" />
        </View>
      </View>

      <View className="flex-row gap-2 mb-6">
        <SkeletonBlock className="flex-1 h-12 rounded-xl animate-pulse" />
        <SkeletonBlock className="flex-1 h-12 rounded-xl animate-pulse" />
        <SkeletonBlock className="flex-1 h-12 rounded-xl animate-pulse" />
      </View>

      <SkeletonBlock className="h-40 rounded-xl animate-pulse" />
    </View>
  );
}
