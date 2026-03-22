/**
 * FeedEmptyState — Display when no properties match the active feed filter.
 *
 * Uses Phosphor icons instead of FontAwesome.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Icon } from './ui/Icon';

interface FeedEmptyStateProps {
  filter?: string;
}

export function FeedEmptyState({ filter }: FeedEmptyStateProps) {
  const getMessage = () => {
    switch (filter) {
      case 'recent':
        return 'No recent properties found. Check back later!';
      case 'trending':
        return 'No trending properties at the moment.';
      case 'activity':
        return 'No recent activity yet. Be the first to like, comment, or guess!';
      default:
        return 'No properties to show.';
    }
  };

  return (
    <View
      className="flex-1 items-center justify-center bg-warm-50 px-6"
      testID="feed-empty"
    >
      <View className="bg-warm-200 p-5 rounded-full mb-4">
        <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
      </View>
      <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
        No properties found
      </Text>
      <Text className="text-warm-500 text-center">{getMessage()}</Text>
    </View>
  );
}
