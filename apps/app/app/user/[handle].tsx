import React from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, usePathname } from 'expo-router';

import { AuthModal } from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { usePublicAchievements } from '@/src/hooks/useAchievements';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { usePublicUserActivity } from '@/src/hooks/useUserActivity';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  ProfilePublicIdentity,
  ProfileReputationSections,
  ProfileSocialStatsRow,
  type ProfileAchievementItem,
} from '@/src/screens/profile/ProfileSurface';
import {
  emitSocialFollowAnalyticsEvent,
  useFollowUser,
  usePublicProfile,
  useUnfollowUser,
} from '@/src/hooks/useUserProfile';
import { useT } from '@/src/i18n';
import { normalizeUserProfileHandle, parseUserProfileRouteParam } from '@/src/utils/user-route';

import type { AchievementDefinition } from '@huishype/shared';

export default function PublicProfileScreen() {
  const t = useT();
  const { isAuthenticated, user } = useAuthContext();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const pathname = usePathname();
  const browserPathname =
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname : null;
  const browserSearchHandle =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('handle')
      : null;
  const pathHandle = React.useMemo(() => {
    const routePathname = pathname?.includes('[handle]') ? null : pathname;
    const match = (routePathname ?? browserPathname)?.match(/\/user\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [browserPathname, pathname]);
  const normalizedHandle =
    parseUserProfileRouteParam(handle ?? null) ??
    parseUserProfileRouteParam(pathHandle) ??
    normalizeUserProfileHandle(pathHandle) ??
    parseUserProfileRouteParam(browserSearchHandle) ??
    normalizeUserProfileHandle(browserSearchHandle);
  const [showAuth, setShowAuth] = React.useState(false);
  const { data: profile, isLoading, isError } = usePublicProfile(normalizedHandle);
  const { data: achievementsData } = usePublicAchievements(profile?.id);
  const { data: activityData } = usePublicUserActivity(profile?.id);
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  const hydratedNow = useHydratedNow();
  const isOwnProfile = profile?.id != null && profile.id === user?.id;
  const isFollowing = profile?.relationship === 'following' || profile?.relationship === 'mutual';
  const isFollowPending = followMutation.isPending || unfollowMutation.isPending;

  const recentActivities = React.useMemo(() => {
    if (!activityData?.pages) return [];
    return activityData.pages.flatMap((page) => page.items).slice(0, 5);
  }, [activityData]);

  const earnedAchievements = React.useMemo<ProfileAchievementItem[]>(() => {
    if (!achievementsData) return [];
    return achievementsData.earned.map((achievement) => ({
      definition: {
        key: achievement.key,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        category: achievement.category,
      } as AchievementDefinition,
      awardedAt: achievement.awardedAt,
    }));
  }, [achievementsData]);

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
        <ScreenBackground
          style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
        >
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
      <ScreenBackground style={styles.screen}>
        <ScrollView style={styles.contentFrame} className="flex-1" testID="public-profile-screen">
          <View style={styles.profileHeader}>
            <ProfilePublicIdentity
              profile={profile}
              action={
                !isOwnProfile ? (
                  <Button
                    label={isFollowing ? t('profile.public.following') : t('common.follow')}
                    onPress={() => void handleFollowPress()}
                    variant={isFollowing ? 'secondary' : 'primary'}
                    disabled={isFollowPending}
                    style={{ alignSelf: 'stretch' }}
                    testID="public-profile-follow-button"
                  />
                ) : (
                  <Text style={styles.ownProfileText}>{t('profile.public.ownProfile')}</Text>
                )
              }
            />
            <ProfileSocialStatsRow
              stats={[
                {
                  key: 'following',
                  label: t('common.following'),
                  value: profile.followingCount,
                  testID: 'public-profile-following-stat',
                },
                {
                  key: 'followers',
                  label: t('common.followers'),
                  value: profile.followerCount,
                  testID: 'public-profile-followers-stat',
                },
                {
                  key: 'comments',
                  label: t('common.comments'),
                  value: profile.commentCount,
                  testID: 'public-profile-comments-stat',
                },
              ]}
            />
          </View>
          <ProfileReputationSections
            guessCount={profile.guessCount}
            karma={profile.karma}
            averageAccuracy={profile.averageAccuracy}
            earnedAchievements={earnedAchievements}
            recentActivities={recentActivities}
            nowMs={hydratedNow}
            bottomSpacer={24}
          />
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

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: 768,
    flex: 1,
  },
  profileHeader: {
    marginTop: 0,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
    overflow: 'visible',
  },
  ownProfileText: {
    fontSize: 12,
    color: '#857D72',
    textAlign: 'center',
  },
});
