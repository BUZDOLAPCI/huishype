import { Pressable, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface FeedErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

/**
 * FeedErrorState - Error display with retry option
 */
export function FeedErrorState({
  message = 'Something went wrong',
  onRetry,
}: FeedErrorStateProps) {
  return (
    <View
      className="flex-1 items-center justify-center bg-gray-50 px-6"
      testID="feed-error"
    >
      <View className="bg-red-100 p-4 rounded-full mb-4">
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" />
      </View>
      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        Oops!
      </Text>
      <Text className="text-gray-500 text-center mb-6">{message}</Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          className="bg-primary-600 px-6 py-3 rounded-full flex-row items-center"
          testID="feed-retry-button"
        >
          <FontAwesome name="refresh" size={14} color="white" />
          <Text className="text-white font-semibold ml-2">Try Again</Text>
        </Pressable>
      )}
    </View>
  );
}
