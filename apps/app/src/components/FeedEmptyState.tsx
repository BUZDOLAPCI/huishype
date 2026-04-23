/**
 * FeedEmptyState — Display when no properties match the active feed filter.
 *
 * Uses Phosphor icons instead of FontAwesome.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Icon } from './ui/Icon';
import type { FeedTab } from '../hooks/useFeed';
import { Button } from './ui/Button';

interface FeedEmptyStateProps {
  filter?: FeedTab;
  signedIn?: boolean;
  onPrimaryAction?: () => void;
}

export function FeedEmptyState({ filter, signedIn = true, onPrimaryAction }: FeedEmptyStateProps) {
  const isFollowing = filter === 'following';
  const title = isFollowing
    ? signedIn
      ? 'Nothing from people you follow yet'
      : 'Sign in to see Following'
    : 'No properties found';

  const getMessage = () => {
    switch (filter) {
      case 'latest':
        return 'No recent properties found. Check back later!';
      case 'trending':
        return 'No trending properties at the moment.';
      case 'recent-activity':
        return 'No property posts yet. Be the first to like, comment, or guess.';
      case 'following':
        return signedIn
          ? 'Follow people from their profiles to build a personal feed.'
          : 'Follow people from profiles to build a personal feed.';
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
      <Text className="text-lg font-semibold text-warm-900 text-center mb-2">{title}</Text>
      <Text className="text-warm-500 text-center">{getMessage()}</Text>
      {isFollowing && onPrimaryAction ? (
        <Button
          label={signedIn ? 'Explore Activity' : 'Sign In'}
          onPress={onPrimaryAction}
          style={{ alignSelf: 'stretch', marginTop: 24 }}
          testID="feed-empty-primary-action"
        />
      ) : null}
    </View>
  );
}
