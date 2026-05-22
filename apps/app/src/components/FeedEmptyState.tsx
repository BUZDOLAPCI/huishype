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
import { useT } from '../i18n';

interface FeedEmptyStateProps {
  filter?: FeedTab;
  signedIn?: boolean;
  onPrimaryAction?: () => void;
}

export function FeedEmptyState({ filter, signedIn = true, onPrimaryAction }: FeedEmptyStateProps) {
  const t = useT();
  const isFollowing = filter === 'following';
  const title = isFollowing
    ? signedIn
      ? t('feed.empty.title.followingSignedIn')
      : t('feed.empty.title.followingSignedOut')
    : t('feed.empty.title.default');

  const getMessage = () => {
    switch (filter) {
      case 'latest':
        return t('feed.empty.latest');
      case 'trending':
        return t('feed.empty.trending');
      case 'recent-activity':
        return t('feed.empty.recentActivity');
      case 'following':
        return signedIn
          ? t('feed.empty.followingSignedIn')
          : t('feed.empty.followingSignedOut');
      default:
        return t('feed.empty.default');
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
          label={signedIn ? t('feed.empty.exploreActivity') : t('common.signIn')}
          onPress={onPrimaryAction}
          style={{ alignSelf: 'stretch', marginTop: 24 }}
          testID="feed-empty-primary-action"
        />
      ) : null}
    </View>
  );
}
