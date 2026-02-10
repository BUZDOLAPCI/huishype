import { Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface FeedEmptyStateProps {
  filter?: string;
}

/**
 * FeedEmptyState - Display when no properties match filters
 */
export function FeedEmptyState({ filter }: FeedEmptyStateProps) {
  const getMessage = () => {
    switch (filter) {
      case 'recent':
        return 'No recent properties found. Check back later!';
      case 'trending':
        return 'No trending properties at the moment.';
      case 'controversial':
        return 'No controversial properties found yet. Submit guesses to get started!';
      case 'price-mismatch':
        return 'No properties with price mismatches found.';
      default:
        return 'No properties to show.';
    }
  };

  return (
    <View
      className="flex-1 items-center justify-center bg-gray-50 px-6"
      testID="feed-empty"
    >
      <View className="bg-gray-200 p-4 rounded-full mb-4">
        <FontAwesome name="home" size={48} color="#9CA3AF" />
      </View>
      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        No properties found
      </Text>
      <Text className="text-gray-500 text-center">{getMessage()}</Text>
    </View>
  );
}
