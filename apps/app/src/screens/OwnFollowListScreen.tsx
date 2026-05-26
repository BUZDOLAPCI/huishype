import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AuthModal } from '@/src/components';
import { useT } from '@/src/i18n';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { Button } from '@/src/components/ui/Button';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useFollowers, useFollowing, type FollowListResponse } from '@/src/hooks/useUserProfile';

type FollowListKind = 'followers' | 'following';

interface OwnFollowListScreenProps {
  kind: FollowListKind;
}

type FollowListItem = FollowListResponse['items'][number];

export function OwnFollowListScreen({ kind }: OwnFollowListScreenProps) {
  const t = useT();
  const { user } = useAuthContext();
  const [showAuth, setShowAuth] = React.useState(false);
  const followersQuery = useFollowers(undefined, kind === 'followers');
  const followingQuery = useFollowing(undefined, kind === 'following');
  const query = kind === 'followers' ? followersQuery : followingQuery;
  const items = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages]
  );
  const localizedTitle = kind === 'followers' ? t('common.followers') : t('common.following');
  const handleBackPress = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/profile');
  }, []);

  if (!user) {
    return (
      <ScreenBackground>
        <ScreenHeader title={localizedTitle} showBackButton onBackPress={handleBackPress} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-warm-900 text-center">
            {t('profile.followList.authTitle', { title: localizedTitle.toLowerCase() })}
          </Text>
          <Text className="text-sm text-warm-500 text-center mt-2">
            {kind === 'followers'
              ? t('profile.followList.followersBody')
              : t('profile.followList.followingBody')}
          </Text>
          <Button
            label={t('common.signIn')}
            onPress={() => setShowAuth(true)}
            style={{ alignSelf: 'stretch', marginTop: 24 }}
            testID={`follow-list-sign-in-${kind}`}
          />
        </View>
        <AuthModal
          visible={showAuth}
          onClose={() => setShowAuth(false)}
          message={t('profile.followList.authTitle', { title: localizedTitle.toLowerCase() })}
          onSuccess={() => setShowAuth(false)}
        />
      </ScreenBackground>
    );
  }

  if (query.isLoading) {
    return (
      <ScreenBackground>
        <ScreenHeader title={localizedTitle} showBackButton onBackPress={handleBackPress} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-warm-500">
            {t('profile.followList.loading', { title: localizedTitle.toLowerCase() })}
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  if (query.isError) {
    return (
      <ScreenBackground>
        <ScreenHeader title={localizedTitle} showBackButton onBackPress={handleBackPress} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-warm-900 text-center">
            {t('profile.followList.errorTitle', { title: localizedTitle.toLowerCase() })}
          </Text>
          <Text className="text-sm text-warm-500 text-center mt-2">
            {query.error instanceof Error ? query.error.message : t('profile.follow.errorFallback')}
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  if (items.length === 0) {
    return (
      <ScreenBackground>
        <ScreenHeader title={localizedTitle} showBackButton onBackPress={handleBackPress} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-warm-900 text-center">
            {t('profile.followList.emptyTitle', { title: localizedTitle.toLowerCase() })}
          </Text>
          <Text className="text-sm text-warm-500 text-center mt-2">
            {kind === 'followers'
              ? t('profile.followList.followersEmptyBody')
              : t('profile.followList.followingEmptyBody')}
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScreenHeader title={localizedTitle} showBackButton onBackPress={handleBackPress} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <Text className="text-sm text-warm-500 text-center py-4">
              {t('profile.followList.loadingMore')}
            </Text>
          ) : null
        }
        testID={`follow-list-${kind}`}
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
    </ScreenBackground>
  );
}
