import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';

import { AuthModal } from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  emitSocialFollowAnalyticsEvent,
  useFollowUser,
  usePublicProfile,
  useUnfollowUser,
} from '@/src/hooks/useUserProfile';

function KarmaRankBadge({ title, level }: { title: string; level: number }) {
  const colors = [
    '#C7BFB3', '#F5A623', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444',
  ];
  const color = colors[Math.min(level - 1, colors.length - 1)] || colors[0];

  return (
    <View className="flex-row items-center px-3 py-1 rounded-full" style={{ backgroundColor: `${color}20` }}>
      <Icon name="Star" size="sm" weight="fill" color={color} />
      <Text className="ml-1 text-xs font-semibold" style={{ color }}>{title}</Text>
    </View>
  );
}

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
  const { isAuthenticated, user } = useAuthContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [showAuth, setShowAuth] = React.useState(false);
  const { data: profile, isLoading, isError } = usePublicProfile(id ?? null);
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
        'Could not update follow status',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  }, [followMutation, isAuthenticated, isFollowing, profile, unfollowMutation, user]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <View className="flex-1 items-center justify-center bg-warm-50">
          <Icon name="User" size={32} color="#DE911D" />
          <Text className="text-warm-500 mt-4">Loading profile...</Text>
        </View>
      </>
    );
  }

  if (isError || !profile) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <View className="flex-1 items-center justify-center bg-warm-50 px-6">
          <Icon name="WarningCircle" size={48} color="#C7BFB3" />
          <Text className="text-lg font-semibold text-warm-900 mt-4">User not found</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScrollView className="flex-1 bg-warm-50" testID="public-profile-screen">
        {/* Profile Header */}
        <View className="bg-surface-card px-6 py-6 items-center border-b border-warm-100">
          <View className="w-20 h-20 rounded-full bg-primary-100 items-center justify-center mb-3">
            <Icon name="User" size={32} color="#DE911D" />
          </View>

          <Text className="text-xl font-bold text-warm-900 mb-1">{profile.displayName}</Text>
          <Text className="text-sm text-warm-400 mb-2">@{profile.handle}</Text>

          <KarmaRankBadge title={profile.karmaRank.title} level={profile.karmaRank.level} />

          <Text className="text-sm text-warm-500 mt-2">{profile.karma} karma</Text>
          {!isOwnProfile ? (
            <Button
              label={isFollowing ? 'Following' : 'Follow'}
              onPress={() => void handleFollowPress()}
              variant={isFollowing ? 'secondary' : 'primary'}
              disabled={isFollowPending}
              style={{ alignSelf: 'stretch', marginTop: 16 }}
              testID="public-profile-follow-button"
            />
          ) : (
            <Text className="text-xs text-warm-500 mt-4">This is your public profile</Text>
          )}
        </View>

        {/* Stats */}
        <View className="bg-surface-card mt-2 px-6 py-5 flex-row border-b border-warm-100">
          <StatItem label="Guesses" value={profile.guessCount} iconName="Crosshair" />
          <StatItem label="Comments" value={profile.commentCount} iconName="ChatCircle" />
        </View>

        <View className="bg-surface-card mt-2 px-6 py-4 flex-row justify-between border-b border-warm-100">
          <View className="items-center flex-1">
            <Text className="text-lg font-bold text-warm-900">{profile.followerCount}</Text>
            <Text className="text-xs text-warm-500">Followers</Text>
          </View>
          <View className="items-center flex-1">
            <Text className="text-lg font-bold text-warm-900">{profile.followingCount}</Text>
            <Text className="text-xs text-warm-500">Following</Text>
          </View>
        </View>

        {/* Member since */}
        <View className="bg-surface-card mt-2 px-6 py-4">
          <Text className="text-sm text-warm-500">
            Member since {new Date(profile.joinedAt).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>
      </ScrollView>
      <AuthModal
        visible={showAuth}
        onClose={() => setShowAuth(false)}
        message="Sign in to follow people"
        onSuccess={() => setShowAuth(false)}
      />
    </>
  );
}
