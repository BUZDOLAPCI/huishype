import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AuthModal } from '@/src/components';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { Button } from '@/src/components/ui/Button';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useFollowers, useFollowing, type FollowListResponse } from '@/src/hooks/useUserProfile';

type FollowListKind = 'followers' | 'following';

interface OwnFollowListScreenProps {
  kind: FollowListKind;
  title: string;
}

type FollowListItem = FollowListResponse['items'][number];

export function OwnFollowListScreen({ kind, title }: OwnFollowListScreenProps) {
  const { user } = useAuthContext();
  const [showAuth, setShowAuth] = React.useState(false);
  const followersQuery = useFollowers();
  const followingQuery = useFollowing();
  const query = kind === 'followers' ? followersQuery : followingQuery;
  const items = query.data?.items ?? [];

  if (!user) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={title} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-warm-900 text-center">
            Sign in to see your {title.toLowerCase()}
          </Text>
          <Text className="text-sm text-warm-500 text-center mt-2">
            {kind === 'followers'
              ? 'See who follows your activity and profile updates.'
              : 'Keep track of the people whose housing activity you follow.'}
          </Text>
          <Button
            label="Sign In"
            onPress={() => setShowAuth(true)}
            style={{ alignSelf: 'stretch', marginTop: 24 }}
            testID={`follow-list-sign-in-${kind}`}
          />
        </View>
        <AuthModal
          visible={showAuth}
          onClose={() => setShowAuth(false)}
          message={`Sign in to see your ${title.toLowerCase()}`}
          onSuccess={() => setShowAuth(false)}
        />
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={title} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-warm-500">Loading {title.toLowerCase()}...</Text>
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={title} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-warm-900 text-center">
            Could not load {title.toLowerCase()}
          </Text>
          <Text className="text-sm text-warm-500 text-center mt-2">
            {query.error instanceof Error ? query.error.message : 'Please try again.'}
          </Text>
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={title} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-warm-900 text-center">
            No {title.toLowerCase()} yet
          </Text>
          <Text className="text-sm text-warm-500 text-center mt-2">
            {kind === 'followers'
              ? 'When people follow you, they will appear here.'
              : 'People you follow will appear here.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-warm-50">
      <ScreenHeader title={title} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }: { item: FollowListItem }) => (
          <Pressable
            onPress={() => router.push(`/user/${item.id}`)}
            className="bg-surface-card rounded-2xl px-4 py-3 flex-row items-center"
            testID={`follow-list-item-${item.id}`}
          >
            <UserAvatar
              username={item.handle}
              displayName={item.displayName}
              profilePhotoUrl={item.profilePhotoUrl}
              size="md"
            />
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-warm-900">{item.displayName}</Text>
              <Text className="text-sm text-warm-500">@{item.handle}</Text>
            </View>
            <Text className="text-xs text-warm-500 capitalize">
              {item.relationship.replace('_', ' ')}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
