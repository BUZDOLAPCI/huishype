/**
 * FeedErrorState — Error display with retry option.
 *
 * Uses Phosphor icons instead of FontAwesome.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './ui/Icon';

interface FeedErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function FeedErrorState({
  message = 'Something went wrong',
  onRetry,
}: FeedErrorStateProps) {
  return (
    <View
      className="flex-1 items-center justify-center bg-warm-50 px-6"
      testID="feed-error"
    >
      <View className="bg-error-red-50 p-4 rounded-full mb-4">
        <Icon name="WarningCircle" size="2xl" color="#E53935" />
      </View>
      <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
        Oops!
      </Text>
      <Text className="text-warm-600 text-center mb-6">{message}</Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          className="bg-primary-700 px-6 py-3 rounded-xl flex-row items-center"
          testID="feed-retry-button"
          accessibilityRole="button"
          accessibilityLabel="Retry loading feed"
        >
          <Text className="text-white font-semibold">Try Again</Text>
        </Pressable>
      )}
    </View>
  );
}
