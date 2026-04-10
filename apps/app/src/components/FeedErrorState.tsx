/**
 * FeedErrorState — Error display with retry option.
 *
 * Uses Phosphor icons instead of FontAwesome.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Button } from './ui/Button';
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
        <Button
          label="Try Again"
          onPress={onRetry}
          style={{ paddingHorizontal: 24 }}
          testID="feed-retry-button"
        />
      )}
    </View>
  );
}
