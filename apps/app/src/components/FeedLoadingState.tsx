import { ActivityIndicator, Text, View } from 'react-native';

/**
 * FeedLoadingState - Full-screen loading spinner for initial feed load
 */
export function FeedLoadingState() {
  return (
    <View
      className="flex-1 items-center justify-center bg-gray-50"
      testID="feed-loading"
    >
      <ActivityIndicator size="large" color="#2563eb" />
      <Text className="text-gray-500 mt-4">Loading properties...</Text>
    </View>
  );
}

/**
 * FeedLoadingMore - Inline loading indicator for pagination
 */
export function FeedLoadingMore() {
  return (
    <View className="py-4 items-center" testID="feed-loading-more">
      <ActivityIndicator size="small" color="#2563eb" />
    </View>
  );
}
