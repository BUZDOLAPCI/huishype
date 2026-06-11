import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';

import { AuthModal } from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  emitSocialFollowAnalyticsEvent,
  useFollowUser,
  usePublicProfile,
  useUnfollowUser,
} from '@/src/hooks/useUserProfile';
import { useT } from '@/src/i18n';
import { parseUserProfileRouteParam } from '@/src/utils/user-route';

function StatItem({ label, value, iconName }: { label: string; value: number; iconName: 'Crosshair' | 'ChatCircle' }) {
  return (
    <View className="items-center flex-1">
      <Icon name={iconName} size="md" color="#9C958A" />
      <Text className="text-lg font-bold text-warm-900 mt-1">{value}</Text>
      <Text className="text-xs text-warm-500">{label}</Text>
    </View>
  );
}

export default function PublicProfileScreen() {
  const t = useT();
  const { isAuthenticated, user } = useAuthContext();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const normalizedHandle = parseUserProfileRouteParam(handle ?? null);
  const [showAuth, setShowAuth] = React.useState(false);
  const { data: profile, isLoading, isError } = usePublicProfile(normalizedHandle);
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  const isOwnProfile = profile?.id != null && profile.id === user?.id;
  const isFollowing = profile?.relationship === 'following' || profile?.relationship === 'mutual';
  const isFollowPending = followMutation.isPending || unfollowMutation.isPending;

  React.useEffect(() => {
    if (!profile || isOwnProfile) {
      return;
    }

    emitSocialFollowAnalyticsEvent('follow_button_impression', {
      targetUserId: profile.id,
      relationship: profile.relationship,
    });
  }, [isOwnProfile, profile]);

  const handleFollowPress = React.useCallback(async () => {
    if (!profile) {
      return;
    }

    emitSocialFollowAnalyticsEvent('follow_button_click', {
      action: isFollowing ? 'unfollow' : 'follow',
      authenticated: isAuthenticated,
      targetUserId: profile.id,
      relationship: profile.relationship,
    });

    if (!user) {
      setShowAuth(true);
      return;
    }

    try {
      if (isFollowing) {
        await unfollowMutation.mutateAsync(profile.id);
      } else {
        await followMutation.mutateAsync(profile.id);
      }
    } catch (error) {
      Alert.alert(
        t('profile.follow.errorTitle'),
        error instanceof Error ? error.message : t('profile.follow.errorFallback'),
      );
    }
  }, [followMutation, isAuthenticated, isFollowing, profile, t, unfollowMutation, user]);

  if (normalizedHandle && isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: t('profile.header') }} />
        <ScreenBackground style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="User" size={32} color="#DE911D" />
          <Text className="text-warm-500 mt-4">{t('profile.public.loading')}</Text>
        </ScreenBackground>
      </>
    );
  }

  if (!normalizedHandle || isError || !profile) {
    return (
      <>
        <Stack.Screen options={{ title: t('profile.header') }} />
        <ScreenBackground style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Icon name="WarningCircle" size={48} color="#C7BFB3" />
          <Text className="text-lg font-semibold text-warm-900 mt-4">
            {t('profile.public.notFound')}
          </Text>
        </ScreenBackground>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScreenBackground>
        <ScrollView className="flex-1" testID="public-profile-screen">
          {/* Profile Header */}
          <View className="bg-surface-card px-6 py-6 items-center border-b border-warm-100">
            <View className="w-20 h-20 rounded-full bg-primary-100 items-center justify-center mb-3">
              <Icon name="User" size={32} color="#DE911D" />
            </View>

            <Text className="text-xl font-bold text-warm-900 mb-1">{profile.displayName}</Text>
            <Text className="text-sm text-warm-400 mb-2">@{profile.handle}</Text>

            <Text className="text-sm text-warm-500 mt-2">
              {t('profile.public.karma', { count: profile.karma })}
            </Text>
            {!isOwnProfile ? (
              <Button
                label={isFollowing ? t('profile.public.following') : t('common.follow')}
                onPress={() => void handleFollowPress()}
                variant={isFollowing ? 'secondary' : 'primary'}
                disabled={isFollowPending}
                style={{ alignSelf: 'stretch', marginTop: 16 }}
                testID="public-profile-follow-button"
              />
            ) : (
              <Text className="text-xs text-warm-500 mt-4">
                {t('profile.public.ownProfile')}
              </Text>
            )}
          </View>

          {/* Stats */}
          <View className="bg-surface-card mt-2 px-6 py-5 flex-row border-b border-warm-100">
            <StatItem label={t('common.guesses')} value={profile.guessCount} iconName="Crosshair" />
            <StatItem label={t('common.comments')} value={profile.commentCount} iconName="ChatCircle" />
          </View>

          <View className="bg-surface-card mt-2 px-6 py-4 flex-row justify-between border-b border-warm-100">
            <View className="items-center flex-1">
              <Text className="text-lg font-bold text-warm-900">{profile.followerCount}</Text>
              <Text className="text-xs text-warm-500">{t('common.followers')}</Text>
            </View>
            <View className="items-center flex-1">
              <Text className="text-lg font-bold text-warm-900">{profile.followingCount}</Text>
              <Text className="text-xs text-warm-500">{t('common.following')}</Text>
            </View>
          </View>

          {/* Member since */}
          <View className="bg-surface-card mt-2 px-6 py-4">
            <Text className="text-sm text-warm-500">
              {t('profile.public.memberSince', {
                date: new Date(profile.joinedAt).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                }),
              })}
            </Text>
          </View>
        </ScrollView>
      </ScreenBackground>
      <AuthModal
        visible={showAuth}
        onClose={() => setShowAuth(false)}
        message={t('profile.follow.auth')}
        onSuccess={() => setShowAuth(false)}
      />
    </>
  );
}
