import { ActivityIndicator, Text, View } from 'react-native';
import { useT } from '../i18n';

/**
 * FeedLoadingState - Full-screen loading spinner for initial feed load
 */
export function FeedLoadingState() {
  const t = useT();

  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: 'transparent' }}
      testID="feed-loading"
    >
      <ActivityIndicator size="large" color="#DE911D" />
      <Text className="text-warm-500 mt-4">{t('feed.loading.properties')}</Text>
    </View>
  );
}

/**
 * FeedLoadingMore - Inline loading indicator for pagination
 */
export function FeedLoadingMore() {
  return (
    <View className="py-4 items-center" testID="feed-loading-more">
      <ActivityIndicator size="small" color="#DE911D" />
    </View>
  );
}
