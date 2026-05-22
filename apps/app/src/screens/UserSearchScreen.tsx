import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { AuthModal } from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useT } from '@/src/i18n';
import {
  emitSocialFollowAnalyticsEvent,
  normalizeUserSearchQuery,
  useFollowUser,
  useUnfollowUser,
  useUserSearch,
  type UserSearchRelationship,
  type UserSearchResult,
} from '@/src/hooks/useUserProfile';

type ResultOverride = Pick<UserSearchResult, 'relationship' | 'followerCount'>;

function isFollowingRelationship(relationship: UserSearchRelationship) {
  return relationship === 'following' || relationship === 'mutual';
}

function getFollowedRelationship(current: UserSearchRelationship): UserSearchRelationship {
  return current === 'followed_by' || current === 'mutual' ? 'mutual' : 'following';
}

function getUnfollowedRelationship(current: UserSearchRelationship): UserSearchRelationship {
  return current === 'mutual' ? 'followed_by' : 'none';
}

export function UserSearchScreen() {
  const t = useT();
  const { user, isAuthenticated } = useAuthContext();
  const [query, setQuery] = React.useState('');
  const [showAuth, setShowAuth] = React.useState(false);
  const [overrides, setOverrides] = React.useState<Record<string, ResultOverride>>({});
  const normalizedQuery = normalizeUserSearchQuery(query);
  const searchQuery = useUserSearch(query);
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  const pendingUserId =
    (followMutation.isPending ? followMutation.variables : null) ??
    (unfollowMutation.isPending ? unfollowMutation.variables : null) ??
    null;

  const results = React.useMemo(
    () =>
      (searchQuery.data?.items ?? []).map((item) => ({
        ...item,
        ...(overrides[item.id] ?? {}),
      })),
    [overrides, searchQuery.data?.items],
  );

  const updateOverride = React.useCallback(
    (item: UserSearchResult, next: ResultOverride | null) => {
      setOverrides((current) => {
        const updated = { ...current };
        if (next) {
          updated[item.id] = next;
        } else {
          delete updated[item.id];
        }
        return updated;
      });
    },
    [],
  );

  const handleToggleFollow = React.useCallback(
    async (item: UserSearchResult) => {
      const isSelf = item.relationship === 'self' || item.id === user?.id;
      if (isSelf) {
        return;
      }

      const isFollowing = isFollowingRelationship(item.relationship);
      emitSocialFollowAnalyticsEvent('follow_button_click', {
        action: isFollowing ? 'unfollow' : 'follow',
        authenticated: isAuthenticated,
        targetUserId: item.id,
        relationship: item.relationship,
        surface: 'user_search',
      });

      if (!user) {
        setShowAuth(true);
        return;
      }

      const previous = {
        relationship: item.relationship,
        followerCount: item.followerCount,
      };
      const optimistic = isFollowing
        ? {
            relationship: getUnfollowedRelationship(item.relationship),
            followerCount: Math.max(0, item.followerCount - 1),
          }
        : {
            relationship: getFollowedRelationship(item.relationship),
            followerCount: item.followerCount + 1,
          };

      updateOverride(item, optimistic);

      try {
        const response = isFollowing
          ? await unfollowMutation.mutateAsync(item.id)
          : await followMutation.mutateAsync(item.id);

        updateOverride(item, {
          relationship: response.relationship,
          followerCount: response.followerCount,
        });
      } catch (error) {
        updateOverride(item, previous);
        Alert.alert(
          t('profile.follow.errorTitle'),
          error instanceof Error ? error.message : t('profile.follow.errorFallback'),
        );
      }
    },
    [
      followMutation,
      isAuthenticated,
      t,
      unfollowMutation,
      updateOverride,
      user,
    ],
  );

  const renderResult = React.useCallback(
    ({ item }: { item: UserSearchResult }) => {
      const isSelf = item.relationship === 'self' || item.id === user?.id;
      const isFollowing = isFollowingRelationship(item.relationship);
      const isPending = pendingUserId === item.id;

      return (
        <View style={styles.resultCard} testID={`user-search-result-${item.id}`}>
          <Pressable
            onPress={() => router.push(`/user/${item.id}`)}
            style={styles.resultIdentity}
            accessibilityRole="button"
            accessibilityLabel={t('userSearch.openProfile', {
              name: item.displayName,
              handle: item.handle,
            })}
          >
            <UserAvatar
              username={item.handle}
              displayName={item.displayName}
              profilePhotoUrl={item.profilePhotoUrl}
              size="md"
            />
            <View style={styles.resultText}>
              <Text style={styles.displayName} numberOfLines={1}>
                {item.displayName}
              </Text>
              <Text style={styles.handle} numberOfLines={1}>
                @{item.handle}
              </Text>
            </View>
          </Pressable>
          {isSelf ? (
            <View style={styles.selfBadge} testID={`user-search-self-${item.id}`}>
              <Text style={styles.selfBadgeText}>{t('userSearch.self')}</Text>
            </View>
          ) : (
            <Button
              label={isFollowing ? t('userSearch.unfollow') : t('common.follow')}
              size="sm"
              variant={isFollowing ? 'secondary' : 'primary'}
              disabled={isPending}
              onPress={() => void handleToggleFollow(item)}
              style={styles.followButton}
              testID={`user-search-follow-${item.id}`}
            />
          )}
        </View>
      );
    },
    [handleToggleFollow, pendingUserId, t, user?.id],
  );

  const showReadyPrompt = normalizedQuery.length < 2;
  const showNoResults =
    normalizedQuery.length >= 2 &&
    !searchQuery.isLoading &&
    !searchQuery.isError &&
    results.length === 0;

  return (
    <ScreenBackground style={styles.screen} testID="user-search-screen">
      <View style={styles.searchBox}>
        <Icon name="MagnifyingGlass" size="md" color="#9C958A" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('userSearch.placeholder')}
          placeholderTextColor="#9C958A"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={styles.searchInput}
          testID="user-search-input"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('userSearch.clear')}
            testID="user-search-clear"
          >
            <Icon name="X" size="sm" color="#9C958A" />
          </Pressable>
        ) : null}
      </View>

      {searchQuery.isError ? (
        <View style={styles.stateBlock} testID="user-search-error">
          <Text style={styles.stateTitle}>{t('userSearch.loadErrorTitle')}</Text>
          <Text style={styles.stateText}>
            {searchQuery.error instanceof Error ? searchQuery.error.message : t('profile.follow.errorFallback')}
          </Text>
        </View>
      ) : showReadyPrompt ? (
        <View style={styles.stateBlock} testID="user-search-idle" />
      ) : searchQuery.isLoading ? (
        <View style={styles.stateBlock} testID="user-search-loading">
          <ActivityIndicator color="#DE911D" />
          <Text style={styles.stateText}>{t('userSearch.loading')}</Text>
        </View>
      ) : showNoResults ? (
        <View style={styles.stateBlock} testID="user-search-empty">
          <Text style={styles.stateTitle}>{t('userSearch.noResults')}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderResult}
          contentContainerStyle={styles.resultList}
          keyboardShouldPersistTaps="handled"
          testID="user-search-results"
        />
      )}

      <AuthModal
        visible={showAuth}
        onClose={() => setShowAuth(false)}
        message={t('profile.follow.auth')}
        onSuccess={() => setShowAuth(false)}
      />
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  searchBox: {
    minHeight: 48,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E0D4',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    color: '#2D2926',
    fontSize: 16,
  },
  resultList: {
    padding: 16,
    gap: 12,
  },
  resultCard: {
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E0D4',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  displayName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D2926',
  },
  handle: {
    marginTop: 2,
    fontSize: 14,
    color: '#9C958A',
  },
  followButton: {
    minWidth: 94,
  },
  selfBadge: {
    minWidth: 64,
    minHeight: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F0E8',
    paddingHorizontal: 12,
  },
  selfBadgeText: {
    color: '#504A42',
    fontSize: 13,
    fontWeight: '600',
  },
  stateBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D2926',
    textAlign: 'center',
  },
  stateText: {
    fontSize: 14,
    color: '#9C958A',
    textAlign: 'center',
  },
});
